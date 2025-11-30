# Apple Wallet Loyalty Service

Servicio backend para integrar tarjetas de lealtad con Apple Wallet en tu aplicación Lovable + Supabase.

## 🚀 Características

- ✅ Generación de archivos .pkpass para Apple Wallet
- ✅ Actualización automática de puntos en tiempo real
- ✅ Notificaciones push cuando cambian los puntos
- ✅ Web Service completo según especificaciones de Apple
- ✅ Integración con Supabase
- ✅ Listo para deployment en Render

## 📋 Requisitos previos

1. **Cuenta Apple Developer** (necesaria para certificados)
2. **Proyecto en Lovable** con Supabase
3. **Cuenta en Render** (o cualquier servicio Node.js)
4. **Certificados de Apple** (ver `certificates/README.md`)

## 🛠️ Instalación local

```bash
# Instalar dependencias
npm install

# Copiar y configurar variables de entorno
cp .env.example .env

# Editar .env con tus credenciales
```

## ⚙️ Configuración

### 1. Configurar Supabase

Ejecuta el SQL en `supabase/schema.sql` en tu Supabase SQL Editor para crear las tablas necesarias:

- `loyalty_points` - Puntos de usuarios
- `wallet_passes` - Passes generados
- `wallet_devices` - Dispositivos registrados para push

### 2. Obtener certificados de Apple

Sigue las instrucciones en `certificates/README.md` para:
1. Crear Pass Type ID en Apple Developer
2. Descargar y convertir certificados a formato PEM
3. Colocarlos en el directorio `certificates/`

### 3. Configurar variables de entorno

Edita `.env` con tus valores:

```env
# Supabase (obtener desde Lovable Settings)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key

# Apple Developer
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ
ORGANIZATION_NAME=Tu Empresa
APPLE_PUSH_CERT_PASSWORD=password-certificado

# URLs (actualizar después del deployment)
BASE_URL=https://tu-servicio.onrender.com
FRONTEND_URL=https://tu-app.lovable.app
```

### 4. Personalizar diseño del pass

Edita `src/templates/loyalty.pass/` para personalizar:
- Colores de fondo y texto
- Imágenes (logo, icon, etc.)
- Campos mostrados

## 🚀 Deployment en Render

### Paso 1: Crear Web Service en Render

1. Ve a https://dashboard.render.com
2. Click en "New +" → "Web Service"
3. Conecta tu repositorio de GitHub
4. Configuración:
   - **Name**: `apple-wallet-service`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (para empezar)

### Paso 2: Variables de entorno en Render

En Settings → Environment, agrega:

```
PORT=3000
NODE_ENV=production
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ
ORGANIZATION_NAME=Tu Empresa
BASE_URL=https://tu-servicio.onrender.com
FRONTEND_URL=https://tu-app.lovable.app
APPLE_PUSH_CERT_PASSWORD=tu-password
```

### Paso 3: Subir certificados a Render

Opción A - Manual (recomendado para empezar):
1. En Render Shell, ejecuta: `mkdir -p certificates`
2. Sube cada certificado manualmente usando el editor de archivos

Opción B - Usando secretos de Render:
1. Convierte certificados a base64
2. Guárdalos como variables de entorno
3. Decodifícalos en startup

### Paso 4: Deploy

Render automáticamente desplegará tu servicio. Espera a que termine.

## 📱 Uso desde Lovable

### 1. Generar pass para un usuario

Desde tu app Lovable, llama al endpoint:

```typescript
// En tu código de Lovable
async function generateWalletPass(userId: string, userName: string, userEmail: string) {
  const response = await fetch('https://tu-servicio.onrender.com/api/passes/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      name: userName,
      email: userEmail,
      points: 0 // Los puntos se obtendrán de Supabase
    })
  });

  if (response.ok) {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    // Crear link de descarga
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loyalty-card.pkpass';
    a.click();
  }
}
```

### 2. Actualizar puntos (con notificación automática)

```typescript
// Cuando actualizas puntos en tu app Lovable
async function updateUserPoints(userId: string, newPoints: number) {
  // 1. Actualizar en Supabase (normal)
  await supabase
    .from('loyalty_points')
    .update({ points: newPoints })
    .eq('user_id', userId);

  // 2. Notificar al wallet
  await fetch('https://tu-servicio.onrender.com/api/webhook/points-updated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, points: newPoints })
  });

  // ¡El wallet del usuario se actualizará automáticamente!
}
```

### 3. Webhook automático de Supabase (opcional)

Configura un Database Webhook en Supabase:
- Table: `loyalty_points`
- Events: `INSERT`, `UPDATE`
- Webhook URL: `https://tu-servicio.onrender.com/api/webhook/supabase`

Esto enviará notificaciones automáticas sin código adicional.

## 🔍 Endpoints disponibles

### API Pública

- `POST /api/passes/generate` - Generar nuevo pass
- `GET /api/passes/:userId` - Obtener info del pass de un usuario
- `POST /api/webhook/points-updated` - Webhook para actualizar puntos
- `POST /api/webhook/supabase` - Webhook de Supabase
- `POST /api/webhook/test` - Probar notificaciones push

### Apple Wallet Web Service

Estos endpoints son usados automáticamente por Apple Wallet:

- `POST /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber` - Registrar dispositivo
- `GET /v1/devices/:deviceId/registrations/:passTypeId` - Listar passes
- `GET /v1/passes/:passTypeId/:serialNumber` - Obtener pass actualizado
- `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber` - Desregistrar
- `POST /v1/log` - Logs de errores

## 🧪 Pruebas

### Probar generación de pass

```bash
curl -X POST https://tu-servicio.onrender.com/api/passes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "name": "Usuario Prueba",
    "email": "test@example.com",
    "points": 1000
  }' \
  --output test.pkpass
```

### Probar notificación push

```bash
curl -X POST https://tu-servicio.onrender.com/api/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "test123"}'
```

## 🏗️ Estructura del proyecto

```
apple-wallet-service/
├── src/
│   ├── config/
│   │   └── supabase.js          # Cliente de Supabase
│   ├── routes/
│   │   ├── passRoutes.js        # Endpoints de generación
│   │   ├── applePassRoutes.js   # Web Service de Apple
│   │   └── webhookRoutes.js     # Webhooks
│   ├── services/
│   │   ├── passGenerator.js     # Lógica de generación de .pkpass
│   │   └── pushNotificationService.js  # Push notifications
│   ├── templates/
│   │   └── loyalty.pass/        # Template del pass
│   │       └── pass.json
│   └── index.js                 # Entry point
├── certificates/                # Certificados de Apple
├── supabase/
│   └── schema.sql              # Schema de base de datos
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 📊 Modelo de datos (Supabase)

### loyalty_points
```sql
- user_id (text, unique)
- points (integer)
- tier (text) - ej: "Básico", "Plata", "Oro"
- name (text)
- email (text)
- created_at, updated_at
```

### wallet_passes
```sql
- user_id (text)
- serial_number (text, unique)
- auth_token (text)
- created_at, updated_at
```

### wallet_devices
```sql
- device_library_identifier (text)
- push_token (text)
- serial_number (text)
- user_id (text)
- last_updated
```

## 🔐 Seguridad

- ✅ Certificados excluidos de Git (.gitignore)
- ✅ Variables de entorno para datos sensibles
- ✅ Tokens de autenticación para web service
- ✅ Row Level Security en Supabase
- ✅ CORS configurado para tu dominio

## 🐛 Troubleshooting

### Error: "Missing Supabase credentials"
- Verifica que `.env` tiene `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`

### Error al generar pass: "Certificate not found"
- Verifica que los archivos .pem están en `certificates/`
- Revisa nombres de archivos: `wwdr.pem`, `signerCert.pem`, `signerKey.pem`

### Push notifications no funcionan
- Verifica que `pushCert.pem` y `pushKey.pem` existen
- Revisa que `APPLE_PUSH_CERT_PASSWORD` es correcto
- En desarrollo, usa certificado de sandbox

### Pass no se instala en iPhone
- Verifica que `PASS_TYPE_IDENTIFIER` coincide con Apple Developer
- Verifica que `TEAM_IDENTIFIER` es correcto
- Revisa certificados (deben estar vigentes)

## 📚 Recursos

- [Apple Wallet Developer Guide](https://developer.apple.com/wallet/)
- [PassKit Package Format](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Web Service Reference](https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes)
- [Supabase Documentation](https://supabase.com/docs)

## 📄 Licencia

MIT

## 💡 Soporte

Si tienes problemas:
1. Revisa los logs en Render Dashboard
2. Verifica configuración de certificados
3. Prueba endpoints con curl o Postman
4. Revisa que Supabase tiene las tablas creadas

---

**¡Listo para usar!** 🎉

Ahora tus usuarios pueden agregar su tarjeta de lealtad a Apple Wallet y recibir actualizaciones automáticas de sus puntos.
