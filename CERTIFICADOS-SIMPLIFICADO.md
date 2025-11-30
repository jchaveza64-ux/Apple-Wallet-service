# 🔐 Certificados necesarios (Versión Simplificada)

## ✅ Lo que ya tienes de Lovable

Si ya tienes `APPLE_APNS_KEY` y `APPLE_APNS_KEY_ID` de Lovable, **¡excelente!** Solo necesitas 3 archivos de certificados (no 5).

---

## 📦 Solo necesitas estos 3 archivos:

### ✅ 1. wwdr.pem
**Apple Worldwide Developer Relations Certificate**
- Necesario para: Firmar passes
- Dónde obtener: https://www.apple.com/certificateauthority/

### ✅ 2. signerCert.pem
**Pass Type ID Certificate**
- Necesario para: Firmar passes
- Dónde obtener: Apple Developer Portal → Pass Type IDs

### ✅ 3. signerKey.pem
**Pass Type ID Private Key**
- Necesario para: Firmar passes
- Dónde obtener: Exportar junto con signerCert desde Keychain

---

## ❌ NO necesitas estos (ya los tienes como tokens):

- ~~pushCert.pem~~ → Reemplazado por `APPLE_APNS_KEY`
- ~~pushKey.pem~~ → Reemplazado por `APPLE_APNS_KEY_ID`

---

## 🚀 Pasos rápidos

### 1. Crear Pass Type ID

1. Ve a: https://developer.apple.com/account/resources/identifiers/list/passTypeId
2. Click en **"+"**
3. Selecciona **"Pass Type IDs"**
4. **Identifier**: `pass.com.tuempresa.loyalty` (debe empezar con `pass.`)
5. Click **"Continue"** → **"Register"**

### 2. Crear Certificate Signing Request (CSR)

**En macOS:**
1. Abre **Keychain Access**
2. Menu: **Keychain Access** → **Certificate Assistant** → **Request a Certificate from a Certificate Authority**
3. Email: tu email de Apple Developer
4. Common Name: `Pass Type ID Certificate`
5. Request is: **"Saved to disk"**
6. Guarda el archivo `.certSigningRequest`

**En Windows:**
```bash
openssl req -new -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr
```

### 3. Generar certificado Pass Type ID

1. En Apple Developer → Pass Type IDs → Selecciona el tuyo
2. Click **"Create Certificate"**
3. Sube el CSR que creaste
4. Click **"Download"** → guarda `pass.cer`

**En macOS:** Haz doble click en `pass.cer` para instalarlo en Keychain

### 4. Descargar WWDR Certificate

1. Ve a: https://www.apple.com/certificateauthority/
2. Descarga **"Worldwide Developer Relations - G4"**
3. Guarda `AppleWWDRCAG4.cer`

**En macOS:** Haz doble click para instalarlo en Keychain

### 5. Exportar a PEM

**En macOS:**

```bash
# 1. Exportar Pass Certificate + Private Key desde Keychain
# Keychain Access → My Certificates → Pass Type ID Certificate
# Selecciona AMBOS (certificado + private key)
# Click derecho → Export 2 items → Guardar como PassCert.p12
# Pon una contraseña y recuérdala

# 2. Convertir a PEM
cd ~/Desktop
mkdir apple-certs

# Certificado
openssl pkcs12 -in PassCert.p12 -clcerts -nokeys -out apple-certs/signerCert.pem

# Private Key
openssl pkcs12 -in PassCert.p12 -nocerts -out apple-certs/signerKey.pem

# WWDR
openssl x509 -inform DER -in ~/Downloads/AppleWWDRCAG4.cer -out apple-certs/wwdr.pem
```

**En Windows:**

```powershell
# Asume que tienes OpenSSL instalado
mkdir C:\apple-certs
cd C:\apple-certs

# Convertir Pass Certificate
openssl pkcs12 -in PassCert.p12 -clcerts -nokeys -out signerCert.pem
openssl pkcs12 -in PassCert.p12 -nocerts -out signerKey.pem

# Convertir WWDR
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
```

### 6. Copiar al proyecto

Copia los 3 archivos `.pem` a la carpeta `certificates/` de tu proyecto:

```
certificates/
├── wwdr.pem          ✅
├── signerCert.pem    ✅
└── signerKey.pem     ✅
```

---

## ⚙️ Configurar variables de entorno

Edita tu `.env`:

```env
# Apple Pass Configuration
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ  # De Apple Developer Membership
ORGANIZATION_NAME=Tu Empresa

# Apple Push Notifications (desde Lovable)
APPLE_APNS_KEY_ID=TU_KEY_ID_DE_LOVABLE
APPLE_APNS_KEY=-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
-----END PRIVATE KEY-----
```

**Nota:** El `APPLE_APNS_KEY` puede ser de una sola línea usando `\n` para los saltos:

```env
APPLE_APNS_KEY=-----BEGIN PRIVATE KEY-----\nMIGTA...\n-----END PRIVATE KEY-----
```

---

## ✅ Verificar que funciona

```bash
# Instalar dependencias
npm install

# Iniciar servicio
npm start
```

Deberías ver:
```
✅ Using local certificate files
✅ All required certificates are present
🚀 Apple Wallet Service running on port 3000
```

---

## 🎯 Resumen

| Archivo | Necesario | Propósito |
|---------|-----------|-----------|
| `wwdr.pem` | ✅ SÍ | Firmar passes |
| `signerCert.pem` | ✅ SÍ | Firmar passes |
| `signerKey.pem` | ✅ SÍ | Firmar passes |
| `pushCert.pem` | ❌ NO | Tienes `APPLE_APNS_KEY` |
| `pushKey.pem` | ❌ NO | Tienes `APPLE_APNS_KEY_ID` |

---

## 🆘 Troubleshooting

### "Certificate not found"
→ Verifica que los 3 archivos `.pem` están en `certificates/`

### "No identity found" al exportar en Keychain
→ Asegúrate de seleccionar AMBOS (certificado + private key) antes de exportar

### Push notifications no funcionan
→ Verifica que `APPLE_APNS_KEY` y `APPLE_APNS_KEY_ID` están correctos en `.env`

---

## 📚 Siguiente paso

Una vez que tengas los 3 certificados `.pem` en la carpeta `certificates/`:

👉 Continúa con **[QUICKSTART.md](./QUICKSTART.md)** para desplegar todo.

---

**¡Mucho más simple que antes!** 🎉
