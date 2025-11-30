# Estructura del Proyecto

```
apple-wallet-service/
│
├── 📄 README.md                    # Documentación principal
├── 📄 QUICKSTART.md                # Guía rápida de inicio (¡EMPIEZA AQUÍ!)
├── 📄 DEPLOYMENT.md                # Guía de deployment en Render
├── 📄 CERTIFICADOS.md              # Guía para obtener certificados de Apple
├── 📄 PROJECT-STRUCTURE.md         # Este archivo
│
├── 📦 package.json                 # Dependencias de Node.js
├── 🔧 render.yaml                  # Configuración para Render
├── 🔒 .env.example                 # Plantilla de variables de entorno
├── 🚫 .gitignore                   # Archivos excluidos de Git
│
├── 📁 src/                         # Código fuente
│   ├── 📄 index.js                 # Entry point del servidor
│   │
│   ├── 📁 config/                  # Configuración
│   │   ├── supabase.js            # Cliente de Supabase
│   │   └── certificates.js        # Gestor de certificados
│   │
│   ├── 📁 routes/                  # Endpoints de la API
│   │   ├── passRoutes.js          # Generar y obtener passes
│   │   ├── applePassRoutes.js     # Web Service de Apple Wallet
│   │   └── webhookRoutes.js       # Webhooks para Lovable/Supabase
│   │
│   ├── 📁 services/                # Lógica de negocio
│   │   ├── passGenerator.js       # Generación de .pkpass
│   │   └── pushNotificationService.js  # Notificaciones push
│   │
│   └── 📁 templates/               # Templates de passes
│       └── loyalty.pass/
│           └── pass.json          # Configuración del pass
│
├── 📁 certificates/                # Certificados de Apple (NO en git)
│   ├── README.md                  # Instrucciones
│   ├── wwdr.pem                   # WWDR Certificate
│   ├── signerCert.pem             # Pass Type ID Certificate
│   ├── signerKey.pem              # Private Key
│   ├── pushCert.pem               # Push Certificate (opcional)
│   └── pushKey.pem                # Push Private Key (opcional)
│
├── 📁 supabase/                    # Configuración de Supabase
│   └── schema.sql                 # Schema de base de datos
│
├── 📁 scripts/                     # Scripts de utilidad
│   ├── convert-certs-to-base64.sh # Convertir certs (macOS/Linux)
│   └── convert-certs-to-base64.ps1 # Convertir certs (Windows)
│
└── 📁 examples/                    # Ejemplos de integración
    └── lovable-integration.tsx    # Código para Lovable
```

---

## 📄 Descripción de archivos principales

### Documentación

| Archivo | Descripción | ¿Cuándo leer? |
|---------|-------------|---------------|
| **QUICKSTART.md** | Guía rápida de 15 minutos | 🚀 **EMPIEZA AQUÍ** |
| **README.md** | Documentación completa | Para referencia detallada |
| **CERTIFICADOS.md** | Cómo obtener certificados de Apple | Antes de empezar |
| **DEPLOYMENT.md** | Deploy paso a paso en Render | Cuando estés listo para producción |

### Código fuente

| Archivo | Descripción | Líneas aprox. |
|---------|-------------|---------------|
| `src/index.js` | Servidor Express, rutas principales | ~55 |
| `src/config/supabase.js` | Conexión a Supabase | ~10 |
| `src/config/certificates.js` | Manejo de certificados | ~120 |
| `src/routes/passRoutes.js` | Generar y consultar passes | ~80 |
| `src/routes/applePassRoutes.js` | Web Service de Apple (4 endpoints) | ~220 |
| `src/routes/webhookRoutes.js` | Webhooks para actualizar puntos | ~90 |
| `src/services/passGenerator.js` | Crear archivos .pkpass | ~180 |
| `src/services/pushNotificationService.js` | Enviar notificaciones push | ~150 |

### Configuración

| Archivo | Propósito |
|---------|-----------|
| `.env.example` | Template de variables de entorno |
| `render.yaml` | Configuración automática para Render |
| `package.json` | Dependencias de Node.js |

### Base de datos

| Archivo | Propósito |
|---------|-----------|
| `supabase/schema.sql` | Crea 3 tablas: loyalty_points, wallet_passes, wallet_devices |

---

## 🔄 Flujo de datos

```
┌─────────────────────────────────────────────────────────────────┐
│                         LOVABLE APP                              │
│  (Frontend - React/Vue)                                          │
│                                                                   │
│  • Usuario click "Agregar a Wallet"                             │
│  • Actualiza puntos después de compra                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Supabase Database           │
         │                               │
         │  • loyalty_points             │
         │  • wallet_passes              │
         │  • wallet_devices             │
         └───────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │   RENDER SERVICE (Node.js)           │
  │   https://tu-servicio.onrender.com   │
  │                                      │
  │  Endpoints:                          │
  │  • POST /api/passes/generate         │ ← Generar nuevo pass
  │  • POST /api/webhook/points-updated  │ ← Actualizar puntos
  │                                      │
  │  Apple Wallet Web Service:           │
  │  • POST /v1/devices/.../registrations│ ← Registrar dispositivo
  │  • GET  /v1/passes/...               │ ← Obtener pass actualizado
  │  • GET  /v1/devices/.../registrations│ ← Listar passes
  │  • DELETE /v1/devices/.../registrations │ ← Desregistrar
  └──────────────┬───────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │  Apple Wallet │
         │   (iPhone)    │
         │               │
         │  • Muestra puntos
         │  • Recibe push
         │  • Actualiza automáticamente
         └───────────────┘
```

---

## 📋 Endpoints disponibles

### Para tu app Lovable:

```
POST   /api/passes/generate          Generar nuevo pass para usuario
GET    /api/passes/:userId           Obtener info del pass de un usuario
POST   /api/webhook/points-updated   Actualizar puntos y enviar push
POST   /api/webhook/supabase         Webhook de Supabase (automático)
POST   /api/webhook/test             Probar notificaciones push
GET    /health                       Health check
```

### Para Apple Wallet (usados automáticamente por iOS):

```
POST   /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
       → Registrar dispositivo para recibir push

GET    /v1/devices/:deviceId/registrations/:passTypeId
       → Listar passes registrados en un dispositivo

GET    /v1/passes/:passTypeId/:serialNumber
       → Obtener pass actualizado

DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
       → Desregistrar dispositivo

POST   /v1/log
       → Recibir logs de errores desde dispositivos
```

---

## 🗄️ Schema de Supabase

### Tabla: `loyalty_points`

Almacena los puntos de cada usuario.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | ID único |
| `user_id` | TEXT | ID del usuario (único) |
| `points` | INTEGER | Puntos acumulados |
| `tier` | TEXT | Nivel: Básico, Plata, Oro, Platino |
| `name` | TEXT | Nombre del usuario |
| `email` | TEXT | Email del usuario |
| `created_at` | TIMESTAMP | Fecha de creación |
| `updated_at` | TIMESTAMP | Última actualización |

### Tabla: `wallet_passes`

Almacena información de los passes generados.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | ID único |
| `user_id` | TEXT | ID del usuario |
| `serial_number` | TEXT | Número de serie del pass (único) |
| `auth_token` | TEXT | Token de autenticación |
| `created_at` | TIMESTAMP | Fecha de generación |
| `updated_at` | TIMESTAMP | Última actualización |

### Tabla: `wallet_devices`

Almacena dispositivos registrados para push notifications.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | ID único |
| `device_library_identifier` | TEXT | ID del dispositivo iOS |
| `push_token` | TEXT | Token para push notifications |
| `pass_type_identifier` | TEXT | Pass Type ID |
| `serial_number` | TEXT | Número de serie del pass |
| `user_id` | TEXT | ID del usuario |
| `last_updated` | TIMESTAMP | Última actualización |

---

## 🔐 Variables de entorno

### Necesarias:

```env
# Servidor
PORT=3000
NODE_ENV=production

# Supabase (desde Lovable)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Apple Developer
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ
ORGANIZATION_NAME=Mi Empresa
APPLE_PUSH_CERT_PASSWORD=password-certificado

# URLs
BASE_URL=https://tu-servicio.onrender.com
FRONTEND_URL=https://tu-app.lovable.app
```

### Opcionales (para Render):

Si usas certificados en base64:

```env
CERT_WWDR_BASE64=LS0tLS1CRUdJTi...
CERT_SIGNER_BASE64=LS0tLS1CRUdJTi...
CERT_SIGNER_KEY_BASE64=LS0tLS1CRUdJTi...
CERT_PUSH_BASE64=LS0tLS1CRUdJTi...
CERT_PUSH_KEY_BASE64=LS0tLS1CRUdJTi...
```

---

## 📦 Dependencias principales

```json
{
  "express": "^4.18.2",           // Servidor web
  "passkit-generator": "^3.8.0",  // Generar .pkpass
  "cors": "^2.8.5",                // CORS
  "dotenv": "^16.3.1",             // Variables de entorno
  "@supabase/supabase-js": "^2.39.0", // Cliente Supabase
  "express-validator": "^7.0.1"    // Validación de requests
}
```

---

## 🚀 Comandos útiles

### Desarrollo local:

```bash
npm install          # Instalar dependencias
npm start            # Iniciar servidor
npm run dev          # Iniciar con auto-reload (si está configurado)
```

### Certificados:

```bash
# macOS/Linux
./scripts/convert-certs-to-base64.sh

# Windows
.\scripts\convert-certs-to-base64.ps1
```

### Git:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/apple-wallet-loyalty.git
git push -u origin main
```

### Pruebas:

```bash
# Health check
curl http://localhost:3000/health

# Generar pass
curl -X POST http://localhost:3000/api/passes/generate \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","name":"Test User","email":"test@example.com"}' \
  --output test.pkpass

# Actualizar puntos
curl -X POST http://localhost:3000/api/webhook/points-updated \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","points":1500}'
```

---

## 📚 Recursos externos

### Apple Developer:
- [Wallet Developer Guide](https://developer.apple.com/wallet/)
- [PassKit Package Format](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Web Service Reference](https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes)
- [Apple Developer Portal](https://developer.apple.com/account/)

### Herramientas:
- [Render](https://render.com) - Hosting
- [Supabase](https://supabase.com) - Base de datos
- [Lovable](https://lovable.app) - Frontend builder

### Librerías:
- [passkit-generator](https://github.com/alexandercerutti/passkit-generator) - NPM package para .pkpass

---

## ✅ Checklist de implementación

### Configuración inicial:
- [ ] Certificados de Apple obtenidos
- [ ] Certificados convertidos a .pem
- [ ] Certificados en carpeta `certificates/`
- [ ] `.env` configurado con todas las variables
- [ ] Schema SQL ejecutado en Supabase

### Desarrollo local:
- [ ] `npm install` ejecutado
- [ ] Servicio arranca sin errores
- [ ] Health check responde OK
- [ ] Pass de prueba se genera correctamente
- [ ] Pass se instala en iPhone

### Deployment:
- [ ] Código subido a GitHub
- [ ] Servicio creado en Render
- [ ] Variables de entorno configuradas en Render
- [ ] Certificados subidos a Render (base64 o manual)
- [ ] `BASE_URL` actualizada después del deploy
- [ ] Servicio en Render responde OK

### Integración con Lovable:
- [ ] Código de ejemplo copiado a Lovable
- [ ] `WALLET_SERVICE_URL` actualizada
- [ ] Botón "Agregar a Wallet" funciona
- [ ] Actualización de puntos funciona
- [ ] Push notifications funcionan

---

## 🎯 Siguientes pasos

1. ✅ Lee **QUICKSTART.md** para empezar
2. ✅ Sigue **CERTIFICADOS.md** para obtener certificados
3. ✅ Prueba localmente
4. ✅ Despliega en Render con **DEPLOYMENT.md**
5. ✅ Integra con Lovable usando **lovable-integration.tsx**
6. ✅ Personaliza diseño y lógica según tus necesidades

---

**¡Éxito con tu proyecto!** 🚀
