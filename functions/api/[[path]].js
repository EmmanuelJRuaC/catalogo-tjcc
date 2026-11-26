// Backend único para Cloudflare Pages Functions.
// Bindings necesarios: CATALOGO (KV), IMAGENES (R2)
// Variables secretas: ADMIN_PASSWORD, SESSION_SECRET

const SESSION_MS = 10 * 60 * 1000; // 10 minutos exactos desde el login
const MAX_IMG_BYTES = 6 * 1024 * 1024;
const MAX_FOTOS = 6;
const enc = new TextEncoder();
const KEY_RE = /^[a-f0-9-]{36}\.(jpg|webp|png)$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function passwordOk(env, given) {
  const a = await hmac(env.SESSION_SECRET, 'pw:' + given);
  const b = await hmac(env.SESSION_SECRET, 'pw:' + env.ADMIN_PASSWORD);
  return safeEqual(a, b);
}

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

// Devuelve el timestamp de expiración si la sesión es válida, o 0
async function sessionExp(req, env) {
  const token = getCookie(req, 'sess');
  if (!token) return 0;
  const [exp, sig] = token.split('.');
  const e = Number(exp);
  if (!e || e < Date.now()) return 0;
  const ok = safeEqual(sig || '', await hmac(env.SESSION_SECRET, 's:' + exp));
  return ok ? e : 0;
}

const text = (v, n) => String(v ?? '').trim().slice(0, n);

function clean(p) {
  return {
    nombre: text(p.nombre, 120),
    categoria: text(p.categoria, 60),
    codigo: text(p.codigo, 40),
    precio: Math.max(0, Number(p.precio) || 0),
    material: text(p.material, 100),
    piedra: text(p.piedra, 100),
    peso: text(p.peso, 40),
    medidas: text(p.medidas, 60),
    descripcion: text(p.descripcion, 1500),
    imagenes: Array.isArray(p.imagenes) ? p.imagenes.filter((k) => KEY_RE.test(k)).slice(0, MAX_FOTOS) : [],
  };
}

const loadAll = async (env) => JSON.parse((await env.CATALOGO.get('products')) || '[]');
const saveAll = (env, list) => env.CATALOGO.put('products', JSON.stringify(list));
const dropImages = async (env, keys) => {
  const valid = (keys || []).filter((k) => KEY_RE.test(k));
  if (valid.length) await env.IMAGENES.delete(valid);
};

export async function onRequest({ request, env, params }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.CATALOGO || !env.IMAGENES) {
    return json({ error: 'El servidor no está configurado (revisa variables y bindings).' }, 500);
  }

  const [a, b, c] = [].concat(params.path || []);
  const method = request.method;
  const secure = new URL(request.url).protocol === 'https:';
  const cookieBase = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

  try {
    // ---------- Login / Logout (sin sesión previa) ----------
    if (a === 'login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!(await passwordOk(env, String(body.password ?? '')))) {
        await new Promise((r) => setTimeout(r, 700)); // frena fuerza bruta
        return json({ error: 'Contraseña incorrecta' }, 401);
      }
      const exp = Date.now() + SESSION_MS;
      const token = `${exp}.${await hmac(env.SESSION_SECRET, 's:' + exp)}`;
      return json({ exp }, 200, { 'set-cookie': `sess=${token}; Max-Age=${SESSION_MS / 1000}; ${cookieBase}` });
    }
    if (a === 'logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': `sess=; Max-Age=0; ${cookieBase}` });
    }

    // ---------- Todo lo demás exige sesión vigente ----------
    const exp = await sessionExp(request, env);
    if (!exp) return json({ error: 'Sesión no válida o expirada' }, 401);

    if (a === 'session' && method === 'GET') return json({ exp });

    // ---------- Imágenes ----------
    if (a === 'upload' && method === 'POST') {
      const type = (request.headers.get('content-type') || '').split(';')[0];
      const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[type];
      if (!ext) return json({ error: 'Formato de imagen no permitido' }, 415);
      const buf = await request.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_IMG_BYTES) return json({ error: 'La imagen supera los 6 MB' }, 413);
      const key = `${crypto.randomUUID()}.${ext}`;
      await env.IMAGENES.put(key, buf, { httpMetadata: { contentType: type } });
      return json({ key }, 201);
    }
    if (a === 'img' && method === 'GET') {
      if (!KEY_RE.test(b || '')) return json({ error: 'No encontrada' }, 404);
      const obj = await env.IMAGENES.get(b);
      if (!obj) return json({ error: 'No encontrada' }, 404);
      return new Response(obj.body, {
        headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=600' },
      });
    }

    // ---------- CRUD de productos ----------
    if (a === 'products') {
      if (!b && method === 'GET') return json({ products: await loadAll(env) });

      if (!b && method === 'POST') {
        const data = clean(await request.json());
        if (!data.nombre) return json({ error: 'El nombre es obligatorio' }, 400);
        const list = await loadAll(env);
        const item = { id: crypto.randomUUID(), ...data, vendido: false, vendidoEn: null, creado: Date.now() };
        list.unshift(item);
        await saveAll(env, list);
        return json({ product: item }, 201);
      }

      if (b) {
        const list = await loadAll(env);
        const i = list.findIndex((p) => p.id === b);
        if (i < 0) return json({ error: 'Pieza no encontrada' }, 404);

        if (!c && method === 'PUT') {
          const data = clean(await request.json());
          if (!data.nombre) return json({ error: 'El nombre es obligatorio' }, 400);
          const removed = list[i].imagenes.filter((k) => !data.imagenes.includes(k));
          list[i] = { ...list[i], ...data };
          await saveAll(env, list);
          await dropImages(env, removed);
          return json({ product: list[i] });
        }

        if (c === 'sold' && method === 'POST') {
          const { vendido } = await request.json();
          list[i].vendido = !!vendido;
          list[i].vendidoEn = vendido ? Date.now() : null;
          await saveAll(env, list);
          return json({ product: list[i] });
        }

        if (!c && method === 'DELETE') {
          const [gone] = list.splice(i, 1);
          await saveAll(env, list);
          await dropImages(env, gone.imagenes);
          return json({ ok: true });
        }
      }
    }

    return json({ error: 'Ruta no encontrada' }, 404);
  } catch (err) {
    return json({ error: 'Error interno del servidor' }, 500);
  }
}
