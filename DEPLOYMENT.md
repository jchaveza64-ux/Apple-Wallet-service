# Guía de Deployment en Render

Esta guía te llevará paso a paso para desplegar el servicio de Apple Wallet en Render.

## 📋 Antes de empezar

Asegúrate de tener:

- [x] Cuenta en Render (https://render.com)
- [x] Repositorio de GitHub con este código
- [x] Certificados de Apple convertidos a PEM
- [x] Credenciales de Supabase
- [x] Pass Type ID y Team ID de Apple Developer

## 🚀 Paso 1: Preparar el repositorio en GitHub

### 1.1 Inicializar Git (si no está inicializado)

```bash
cd apple-wallet-service
git init
git add .
git commit -m "Initial commit: Apple Wallet service"
```

### 1.2 Crear repositorio en GitHub

1. Ve a https://github.com/new
2. Crea un repositorio nuevo (ej: `apple-wallet-loyalty`)
3. **NO** inicialices con README (ya tenemos código)

### 1.3 Subir código a GitHub

```bash
# Reemplaza con tu URL de GitHub
git remote add origin https://github.com/TU_USUARIO/apple-wallet-loyalty.git
git branch -M main
git push -u origin main
```

⚠️ **IMPORTANTE**: Antes de hacer push, verifica que `.gitignore` excluye:
- `.env` ✅
- `certificates/*.pem` ✅
- `certificates/*.p12` ✅

## 🎯 Paso 2: Crear servicio en Render

### 2.1 Conectar GitHub a Render

1. Ve a https://dashboard.render.com
2. Click en **"New +"** → **"Web Service"**
3. Si es tu primera vez, autoriza Render a acceder a GitHub
4. Selecciona tu repositorio `apple-wallet-loyalty`

### 2.2 Configurar el servicio

Completa el formulario:

| Campo | Valor |
|-------|-------|
| **Name** | `apple-wallet-service` |
| **Region** | Elige el más cercano (US East recomendado) |
| **Branch** | `main` |
| **Root Directory** | (dejar vacío) |
| **Environment** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | `Free` (para empezar) |

### 2.3 Click en **"Advanced"** y agrega variables de entorno

Agrega TODAS estas variables (click en "Add Environment Variable"):

```
NODE_ENV = production
PORT = 3000
```

**CRÍTICO - Completa con tus valores:**

```
SUPABASE_URL = https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJhbGc...tu-service-key
PASS_TYPE_IDENTIFIER = pass.com.tuempresa.loyalty
TEAM_IDENTIFIER = ABC123XYZ
ORGANIZATION_NAME = Tu Empresa
APPLE_PUSH_CERT_PASSWORD = tu-password-certificado
```

**Estas las actualizarás después del deploy:**

```
BASE_URL = https://apple-wallet-service.onrender.com
FRONTEND_URL = https://tu-app.lovable.app
```

### 2.4 Crear el servicio

Click en **"Create Web Service"**

Render comenzará a:
1. ✅ Clonar tu repositorio
2. ✅ Ejecutar `npm install`
3. ✅ Ejecutar `npm start`
4. ✅ Asignar una URL pública

Espera 2-5 minutos. Verás logs en tiempo real.

## 📦 Paso 3: Subir certificados a Render

Los certificados NO deben estar en Git, así que los subiremos manualmente.

### Opción A: Usando Render Shell (Recomendado)

1. En tu servicio de Render, ve a la pestaña **"Shell"**
2. Click en **"Launch Shell"**
3. Ejecuta estos comandos:

```bash
# Crear directorio
mkdir -p certificates

# Ahora necesitas subir los archivos manualmente
# Ve a la pestaña "Files" o usa el siguiente método
```

### Opción B: Usando render.com File Upload

Render no tiene upload directo, así que usaremos variables de entorno:

1. En tu máquina local, convierte certificados a base64:

**En macOS/Linux:**
```bash
cd certificates
base64 -i wwdr.pem > wwdr.base64.txt
base64 -i signerCert.pem > signerCert.base64.txt
base64 -i signerKey.pem > signerKey.base64.txt
base64 -i pushCert.pem > pushCert.base64.txt
base64 -i pushKey.pem > pushKey.base64.txt
```

**En Windows (PowerShell):**
```powershell
cd certificates
[Convert]::ToBase64String([IO.File]::ReadAllBytes("wwdr.pem")) > wwdr.base64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("signerCert.pem")) > signerCert.base64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("signerKey.pem")) > signerKey.base64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("pushCert.pem")) > pushCert.base64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("pushKey.pem")) > pushKey.base64.txt
```

2. En Render Dashboard → Environment, agrega:

```
CERT_WWDR_BASE64 = (pega contenido de wwdr.base64.txt)
CERT_SIGNER_BASE64 = (pega contenido de signerCert.base64.txt)
CERT_SIGNER_KEY_BASE64 = (pega contenido de signerKey.base64.txt)
CERT_PUSH_BASE64 = (pega contenido de pushCert.base64.txt)
CERT_PUSH_KEY_BASE64 = (pega contenido de pushKey.base64.txt)
```

3. Modifica `src/config/certificates.js` para decodificar (te daré el código abajo)

### Opción C: Usar Render Disk (Más complejo, para producción)

Render Free no incluye persistent disk, pero en planes pagos puedes montar un disco.

## 📝 Paso 4: Actualizar URLs

Una vez que tu servicio esté desplegado:

1. Copia la URL de Render (ej: `https://apple-wallet-service.onrender.com`)
2. En Render Dashboard → Environment, actualiza:
   ```
   BASE_URL = https://apple-wallet-service.onrender.com
   ```
3. Click en **"Save Changes"** - Render redesplegará automáticamente

## 🗄️ Paso 5: Configurar Supabase

### 5.1 Ejecutar Schema SQL

1. Ve a tu proyecto Supabase: https://supabase.com/dashboard
2. Click en **"SQL Editor"**
3. Copia TODO el contenido de `supabase/schema.sql`
4. Pégalo en el editor
5. Click en **"Run"**

Esto creará las tablas:
- ✅ `loyalty_points`
- ✅ `wallet_passes`
- ✅ `wallet_devices`

### 5.2 Configurar Webhook (Opcional)

Para actualizaciones automáticas:

1. En Supabase Dashboard → **Database** → **Webhooks**
2. Click en **"Create a new hook"**
3. Configura:
   - **Name**: `wallet-points-update`
   - **Table**: `loyalty_points`
   - **Events**: `INSERT`, `UPDATE`
   - **Type**: `HTTP Request`
   - **Method**: `POST`
   - **URL**: `https://apple-wallet-service.onrender.com/api/webhook/supabase`
   - **HTTP Headers**: `Content-Type: application/json`
4. Click en **"Create webhook"**

## ✅ Paso 6: Verificar que funciona

### 6.1 Health Check

Abre en el navegador:
```
https://apple-wallet-service.onrender.com/health
```

Deberías ver:
```json
{
  "status": "ok",
  "service": "Apple Wallet Loyalty Service",
  "timestamp": "2024-..."
}
```

### 6.2 Probar generación de pass

Desde tu terminal local:

```bash
curl -X POST https://apple-wallet-service.onrender.com/api/passes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "name": "Usuario de Prueba",
    "email": "test@example.com",
    "points": 1500
  }' \
  --output test.pkpass
```

Si funciona, tendrás un archivo `test.pkpass` que puedes abrir en iPhone.

### 6.3 Revisar logs

En Render Dashboard → **Logs**, verifica que no hay errores.

## 🔧 Troubleshooting

### Error: "Missing Supabase credentials"
- Ve a Render → Environment
- Verifica que `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están configuradas
- Click en "Save Changes"

### Error: "Certificate not found"
- Los certificados no se subieron correctamente
- Usa la Opción B (base64) de arriba
- O contacta a soporte de Render para subir archivos manualmente

### Servicio no inicia
- Revisa logs en Render Dashboard
- Verifica que `package.json` tiene el script `"start": "node src/index.js"`
- Verifica que todas las dependencias están en `package.json`

### 502 Bad Gateway
- El servicio está iniciando (toma 1-2 min en Free plan)
- O hay un error en el código, revisa logs

## 🔄 Paso 7: Configurar Auto-Deploy (Opcional)

Render automáticamente redesplega cuando haces push a GitHub:

1. En Render Dashboard → **Settings**
2. **Auto-Deploy**: Ya está activado por defecto ✅

Ahora cada vez que hagas:
```bash
git add .
git commit -m "Update feature"
git push
```

Render redesplegará automáticamente.

## 🎨 Paso 8: Personalizar el pass

1. Edita `src/templates/loyalty.pass/pass.json`
2. Cambia colores, textos, etc.
3. Agrega imágenes (logo.png, icon.png) al directorio
4. Commit y push:
   ```bash
   git add src/templates/
   git commit -m "Customize pass design"
   git push
   ```

## 📱 Paso 9: Integrar con Lovable

En tu app de Lovable, agrega el botón "Agregar a Wallet":

```tsx
// Ejemplo de componente React en Lovable
import { Button } from "@/components/ui/button";

export function AddToWalletButton({ userId, userName, userEmail }) {
  const handleAddToWallet = async () => {
    try {
      const response = await fetch(
        'https://apple-wallet-service.onrender.com/api/passes/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            name: userName,
            email: userEmail
          })
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'loyalty-card.pkpass';
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error adding to wallet:', error);
    }
  };

  return (
    <Button onClick={handleAddToWallet}>
      Agregar a Apple Wallet
    </Button>
  );
}
```

## 🎉 ¡Listo!

Tu servicio de Apple Wallet está funcionando en producción.

**Next steps:**
1. ✅ Prueba generar un pass
2. ✅ Instálalo en tu iPhone
3. ✅ Actualiza puntos desde Lovable
4. ✅ Verifica que el wallet se actualiza automáticamente

## 💰 Costos

- **Render Free**: $0/mes, servicio se duerme después de 15 min sin uso
- **Render Starter**: $7/mes, siempre activo, mejor para producción
- **Supabase Free**: $0/mes, suficiente para empezar
- **Apple Developer**: $99/año (ya lo tienes)

## 📞 Soporte

Si algo no funciona:
1. Revisa logs en Render
2. Verifica variables de entorno
3. Prueba endpoints con curl
4. Revisa que Supabase tiene las tablas creadas

---

**¡Éxito con tu integración!** 🚀
