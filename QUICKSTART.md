# 🚀 Quick Start - Apple Wallet Loyalty Cards

Guía rápida para poner en marcha tu servicio de Apple Wallet en **15 minutos**.

## ✅ Checklist previo

Antes de empezar, asegúrate de tener:

- [ ] Cuenta de Apple Developer ($99/año)
- [ ] Proyecto Lovable funcionando
- [ ] Acceso a Supabase (incluido en Lovable)
- [ ] Cuenta en Render.com (gratis)
- [ ] Node.js instalado localmente (opcional, para pruebas)

---

## 📝 Paso 1: Obtener certificados de Apple (20 min)

Esta es la parte más importante. **Sigue la guía detallada:**

👉 **[Abre CERTIFICADOS.md](./CERTIFICADOS.md)** y sigue todos los pasos.

Resumen rápido:
1. Crear Pass Type ID en Apple Developer
2. Crear Certificate Signing Request (CSR)
3. Descargar certificados (.cer)
4. Convertir a formato .pem
5. Copiar a la carpeta `certificates/`

Al terminar deberías tener:
```
certificates/
├── wwdr.pem
├── signerCert.pem
├── signerKey.pem
├── pushCert.pem (opcional)
└── pushKey.pem (opcional)
```

---

## 🗄️ Paso 2: Configurar Supabase (5 min)

### 2.1 Ejecutar SQL

1. Ve a tu proyecto Supabase: https://supabase.com/dashboard
2. Click en **SQL Editor**
3. Abre `supabase/schema.sql` de este proyecto
4. Copia TODO el contenido
5. Pégalo en Supabase SQL Editor
6. Click en **Run**

Esto crea 3 tablas:
- `loyalty_points` - Puntos de usuarios
- `wallet_passes` - Passes generados
- `wallet_devices` - Dispositivos para push

### 2.2 Obtener credenciales de Supabase

En Lovable, ve a:
1. **Settings** → **Integrations** → **Supabase**
2. Copia:
   - `SUPABASE_URL` (ej: https://xxxxx.supabase.co)
   - `SUPABASE_ANON_KEY` o `SERVICE_ROLE_KEY`

**Guárdalos** - los necesitarás en el siguiente paso.

---

## ⚙️ Paso 3: Configurar variables de entorno (2 min)

1. Copia el archivo de ejemplo:
   ```bash
   cp .env.example .env
   ```

2. Edita `.env` con tus valores:

```env
# Supabase (de Lovable)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Apple Developer (de CERTIFICADOS.md)
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ
ORGANIZATION_NAME=Mi Empresa
APPLE_PUSH_CERT_PASSWORD=tu-password-certificado

# URLs (actualizar después del deploy)
BASE_URL=http://localhost:3000
FRONTEND_URL=https://tu-app.lovable.app
```

---

## 🧪 Paso 4: Probar localmente (5 min)

### 4.1 Instalar dependencias

```bash
npm install
```

### 4.2 Iniciar el servicio

```bash
npm start
```

Deberías ver:
```
✅ Using local certificate files
✅ All required certificates are present
🚀 Apple Wallet Service running on port 3000
📱 Environment: development
```

### 4.3 Probar el health check

Abre en el navegador:
```
http://localhost:3000/health
```

Deberías ver:
```json
{
  "status": "ok",
  "service": "Apple Wallet Loyalty Service",
  "timestamp": "2024-..."
}
```

### 4.4 Generar un pass de prueba

En otra terminal:

```bash
curl -X POST http://localhost:3000/api/passes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "name": "Usuario Prueba",
    "email": "test@example.com",
    "points": 1500
  }' \
  --output test.pkpass
```

Si funciona, tendrás un archivo `test.pkpass`.

**En iPhone:**
1. Envíate el archivo por email o AirDrop
2. Ábrelo
3. Click en "Agregar" arriba a la derecha
4. ¡Deberías ver tu tarjeta en Apple Wallet! 🎉

---

## 🚀 Paso 5: Deploy en Render (10 min)

### 5.1 Subir a GitHub

```bash
# Inicializar git (si no lo has hecho)
git init
git add .
git commit -m "Initial commit: Apple Wallet service"

# Crear repo en GitHub y subir
git remote add origin https://github.com/TU_USUARIO/apple-wallet-loyalty.git
git branch -M main
git push -u origin main
```

### 5.2 Crear servicio en Render

👉 **[Sigue la guía completa en DEPLOYMENT.md](./DEPLOYMENT.md)**

Resumen:
1. Ve a https://dashboard.render.com
2. **New +** → **Web Service**
3. Conecta tu repo de GitHub
4. Configura:
   - Name: `apple-wallet-service`
   - Build: `npm install`
   - Start: `npm start`
5. Agrega todas las variables de entorno
6. Click en **Create Web Service**

### 5.3 Subir certificados a Render

**Opción recomendada: Base64**

En Windows (PowerShell):
```powershell
.\scripts\convert-certs-to-base64.ps1
```

En macOS/Linux:
```bash
chmod +x scripts/convert-certs-to-base64.sh
./scripts/convert-certs-to-base64.sh
```

Esto te mostrará los valores en base64. Cópialos a Render:
1. Render Dashboard → Environment
2. Agrega cada variable (ej: `CERT_WWDR_BASE64`)
3. Pega el valor en base64
4. Save changes

### 5.4 Actualizar BASE_URL

Una vez desplegado:
1. Copia la URL de Render (ej: `https://apple-wallet-service.onrender.com`)
2. En Render → Environment, actualiza:
   ```
   BASE_URL=https://apple-wallet-service.onrender.com
   ```
3. Save (Render redesplegará automáticamente)

---

## 📱 Paso 6: Integrar con Lovable (10 min)

### 6.1 Copiar código de ejemplo

1. Abre `examples/lovable-integration.tsx`
2. Copia el código a tu proyecto Lovable
3. Actualiza la URL:
   ```typescript
   const WALLET_SERVICE_URL = 'https://tu-servicio.onrender.com';
   ```

### 6.2 Usar en tu app

En cualquier componente de Lovable:

```tsx
import { AddToWalletButton, useAppleWallet } from './lovable-integration';

export function MyComponent() {
  const { addPoints } = useAppleWallet();

  // Cuando el usuario compra algo
  const handlePurchase = async (amount: number) => {
    const userId = "user123"; // Obtener del auth
    await addPoints(userId, Math.floor(amount)); // 1 punto por $1
  };

  return (
    <div>
      <AddToWalletButton />
      <button onClick={() => handlePurchase(100)}>
        Comprar $100
      </button>
    </div>
  );
}
```

---

## ✅ Verificar que todo funciona

### Test 1: Generar pass desde Lovable

1. En tu app Lovable, click en "Agregar a Apple Wallet"
2. Se descarga un archivo `.pkpass`
3. Ábrelo en iPhone
4. Se agrega a Wallet ✅

### Test 2: Actualizar puntos

1. En tu app, realiza una compra (o simula una)
2. Los puntos se actualizan en Supabase
3. Espera 5-10 segundos
4. Abre Apple Wallet en iPhone
5. La tarjeta se actualiza automáticamente ✅

### Test 3: Notificaciones push

```bash
# Probar desde terminal
curl -X POST https://tu-servicio.onrender.com/api/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123"}'
```

Tu wallet debería actualizarse ✅

---

## 🎨 Personalizar diseño

### Cambiar colores

Edita `src/services/passGenerator.js`:

```javascript
backgroundColor: 'rgb(255, 87, 34)',  // Naranja
foregroundColor: 'rgb(255, 255, 255)', // Blanco
labelColor: 'rgb(255, 255, 255)',      // Blanco
```

### Agregar logo

1. Crea tu logo en formato PNG
2. Tamaños necesarios:
   - `logo.png` - 160x50 px (@1x)
   - `logo@2x.png` - 320x100 px (@2x)
   - `logo@3x.png` - 480x150 px (@3x)
   - `icon.png` - 29x29 px (@1x)
   - `icon@2x.png` - 58x58 px (@2x)
   - `icon@3x.png` - 87x87 px (@3x)
3. Colócalos en `src/templates/loyalty.pass/`
4. Commit y push a GitHub (Render redesplegará)

---

## 🐛 Problemas comunes

### "Missing Supabase credentials"
→ Verifica `.env` o variables de entorno en Render

### "Certificate not found"
→ Verifica que los archivos `.pem` están en `certificates/`

### Pass no se instala en iPhone
→ Verifica `PASS_TYPE_IDENTIFIER` y `TEAM_IDENTIFIER`

### Wallet no se actualiza automáticamente
→ Verifica que `pushCert.pem` y `pushKey.pem` existen

### 502 Bad Gateway en Render
→ El servicio está iniciando, espera 1-2 minutos

### Más ayuda
→ Revisa logs en Render Dashboard

---

## 📚 Siguientes pasos

Ahora que todo funciona:

1. ✅ Personaliza el diseño de la tarjeta
2. ✅ Configura tu lógica de puntos
3. ✅ Agrega niveles (Básico, Plata, Oro, Platino)
4. ✅ Implementa recompensas
5. ✅ Agrega código de barras personalizado
6. ✅ Configura campos adicionales

### Documentación completa:

- 📖 [README.md](./README.md) - Documentación completa
- 🔐 [CERTIFICADOS.md](./CERTIFICADOS.md) - Guía de certificados
- 🚀 [DEPLOYMENT.md](./DEPLOYMENT.md) - Guía de deployment
- 💻 [examples/lovable-integration.tsx](./examples/lovable-integration.tsx) - Ejemplos de código

---

## 💰 Costos estimados

- **Apple Developer**: $99/año (ya lo tienes)
- **Render Free**: $0/mes
  - Servicio se duerme después de 15 min sin uso
  - Suficiente para empezar
- **Render Starter**: $7/mes (recomendado para producción)
  - Siempre activo
  - Mejor rendimiento
- **Supabase**: $0/mes (incluido en Lovable)

**Total para empezar: $0/mes** (solo necesitas Apple Developer)

---

## 🎉 ¡Listo!

Tu servicio de Apple Wallet está funcionando. Tus usuarios pueden:
- ✅ Agregar tarjeta de lealtad a Apple Wallet
- ✅ Ver sus puntos en tiempo real
- ✅ Recibir actualizaciones automáticas
- ✅ Usar código de barras para escanear en PDV

**¿Necesitas ayuda?** Revisa los logs en Render o los archivos de documentación.

---

**Happy coding! 🚀**
