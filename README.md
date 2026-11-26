# Catálogo de Joyería (Cloudflare Pages + Functions)

Sin base de datos tradicional: los productos se guardan en **Workers KV** y las fotos en **R2**.
Ambos son gratuitos para este uso.

## Despliegue

1. `npm i -g wrangler` y `npx wrangler login`
2. Crear almacenamiento:
   - `npx wrangler kv namespace create CATALOGO` → copia el `id` en `wrangler.toml`
   - `npx wrangler r2 bucket create joyeria-imagenes` (activa R2 antes en el panel de Cloudflare)
3. Crear proyecto y secretos:
   - `npx wrangler pages project create joyeria --production-branch main`
   - `npx wrangler pages secret put ADMIN_PASSWORD --project-name joyeria`  (tu contraseña)
   - `npx wrangler pages secret put SESSION_SECRET --project-name joyeria`  (texto aleatorio largo)
4. Publicar: `npx wrangler pages deploy`

Prueba local: copia `.dev.vars.example` a `.dev.vars` y ejecuta `npx wrangler pages dev`.

## Personalizar
Nombre, moneda y categorías: arriba de `public/app.js` (objeto `CONFIG`).

## Cómo funciona la sesión
Al ingresar la contraseña, el servidor crea una cookie firmada (HttpOnly) que vence a los 10 minutos exactos.
Recargar la página no pide la contraseña mientras esa cookie viva. Al terminar el tiempo, el catálogo
se oculta y hay que recargar e ingresar la clave otra vez. Los datos y las fotos solo se entregan con la cookie válida.

## Recomendación
En Cloudflare → Security → WAF, agrega una regla de *Rate limiting* para `/api/login` (p. ej. 10 intentos por minuto).
