# Guía Completa: Obtener Certificados de Apple Developer

Esta guía te ayudará a obtener y configurar todos los certificados necesarios para Apple Wallet.

## 📋 Requisitos

- ✅ Cuenta de Apple Developer activa ($99/año)
- ✅ Acceso a https://developer.apple.com/account
- ✅ Mac con Keychain Access (recomendado) o Windows con OpenSSL

## 🔑 Certificados necesarios

1. **Pass Type ID Certificate** - Para firmar los passes (.pkpass)
2. **WWDR Certificate** - Apple Worldwide Developer Relations
3. **Apple Push Notification Certificate** - Para notificaciones push (opcional pero recomendado)

---

## Paso 1: Crear Pass Type ID

### 1.1 Ir a Apple Developer Portal

1. Ve a: https://developer.apple.com/account/resources/identifiers/list
2. Inicia sesión con tu cuenta de Apple Developer
3. En el menú superior, selecciona **"Identifiers"**
4. Click en el botón **"+"** (arriba a la izquierda)

### 1.2 Crear el identificador

1. Selecciona **"Pass Type IDs"**
2. Click en **"Continue"**
3. Completa los campos:
   - **Description**: `Loyalty Card` (o el nombre que prefieras)
   - **Identifier**: `pass.com.tuempresa.loyalty`
     - ⚠️ **IMPORTANTE**: Debe empezar con `pass.`
     - Usa tu dominio o nombre de empresa
     - Ejemplo: `pass.com.miapp.loyalty`
     - **Este valor lo necesitarás para el .env**
4. Click en **"Continue"** → **"Register"**

### 1.3 Crear el certificado

1. En la lista de Pass Type IDs, encuentra el que acabas de crear
2. Click en él para ver los detalles
3. Click en **"Create Certificate"**
4. Ahora necesitas un Certificate Signing Request (CSR)

---

## Paso 2: Crear Certificate Signing Request (CSR)

### En macOS:

1. Abre **Keychain Access** (Acceso a Llaveros)
   - Lo encuentras en: Applications → Utilities → Keychain Access
2. En el menú superior: **Keychain Access** → **Certificate Assistant** → **Request a Certificate from a Certificate Authority**
3. Completa el formulario:
   - **User Email Address**: tu email de Apple Developer
   - **Common Name**: `Pass Type ID Certificate` (o cualquier nombre descriptivo)
   - **CA Email Address**: déjalo vacío
   - **Request is**: Selecciona **"Saved to disk"**
4. Click en **"Continue"**
5. Guarda el archivo `CertificateSigningRequest.certSigningRequest` en tu escritorio

### En Windows:

Si no tienes Mac, puedes usar OpenSSL:

1. Descarga e instala OpenSSL: https://slproweb.com/products/Win32OpenSSL.html
2. Abre CMD o PowerShell
3. Ejecuta:
```bash
openssl req -new -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr
```
4. Completa la información solicitada
5. Usa el archivo `pass.csr` como tu CSR

---

## Paso 3: Subir CSR y descargar certificado

### 3.1 Subir el CSR

1. Regresa a Apple Developer Portal (donde estabas creando el certificado)
2. Click en **"Choose File"**
3. Selecciona el archivo `.certSigningRequest` que creaste
4. Click en **"Continue"**

### 3.2 Descargar el certificado

1. Click en **"Download"**
2. Se descargará un archivo llamado `pass.cer` o similar
3. **GUARDA ESTE ARCHIVO** - lo necesitarás después

### En macOS:
4. Haz doble click en el archivo `.cer` para instalarlo en Keychain
5. Deberías verlo en Keychain Access bajo "My Certificates"

---

## Paso 4: Descargar WWDR Certificate

1. Ve a: https://www.apple.com/certificateauthority/
2. Busca **"Worldwide Developer Relations - G4 (Expiring 12/10/2030)"**
3. Click en **"Download"** para descargar `AppleWWDRCAG4.cer`
4. **GUARDA ESTE ARCHIVO**

### En macOS:
5. Haz doble click para instalarlo en Keychain

---

## Paso 5: Crear Apple Push Notification Certificate (Opcional)

**Nota**: Solo necesario si quieres notificaciones push. Puedes omitir esto inicialmente.

### 5.1 Crear el certificado

1. Ve a: https://developer.apple.com/account/resources/certificates/list
2. Click en **"+"** para crear un nuevo certificado
3. Selecciona **"Apple Push Notification service SSL (Sandbox & Production)"**
4. Click en **"Continue"**
5. Selecciona tu **Pass Type ID** de la lista
6. Click en **"Continue"**
7. Sube el mismo CSR que creaste antes (o crea uno nuevo)
8. Click en **"Continue"** → **"Download"**
9. Se descargará `aps.cer`

---

## Paso 6: Convertir certificados a formato PEM

Ahora necesitas convertir los certificados de formato `.cer` a `.pem` para usarlos en Node.js.

### En macOS:

#### 6.1 Exportar Pass Type ID Certificate con Private Key

1. Abre **Keychain Access**
2. Ve a **"My Certificates"**
3. Encuentra tu **"Pass Type ID Certificate"**
4. Expándelo (flecha a la izquierda) - verás la private key debajo
5. **Selecciona ambos** (el certificado Y la private key)
6. Click derecho → **"Export 2 items..."**
7. Formato: **Personal Information Exchange (.p12)**
8. Guarda como `PassCert.p12`
9. **Te pedirá una contraseña** - elige una y **RECUÉRDALA** (la necesitarás en el .env)

#### 6.2 Convertir a PEM usando Terminal

Abre Terminal y ejecuta estos comandos:

```bash
# Crear directorio para certificados
mkdir ~/Desktop/apple-wallet-certs
cd ~/Desktop/apple-wallet-certs

# Convertir Pass Type ID Certificate a PEM (certificado)
openssl pkcs12 -in ~/Desktop/PassCert.p12 -clcerts -nokeys -out signerCert.pem

# Convertir Pass Type ID Private Key a PEM
openssl pkcs12 -in ~/Desktop/PassCert.p12 -nocerts -out signerKey.pem

# Convertir WWDR Certificate a PEM
openssl x509 -inform DER -in ~/Downloads/AppleWWDRCAG4.cer -out wwdr.pem

# Si tienes Push Notification Certificate, repite el proceso
# (exportar de Keychain como .p12, luego convertir)
openssl pkcs12 -in ~/Desktop/PushCert.p12 -clcerts -nokeys -out pushCert.pem
openssl pkcs12 -in ~/Desktop/PushCert.p12 -nocerts -out pushKey.pem
```

**Te pedirá contraseñas:**
- **Import Password**: La contraseña que pusiste al exportar el .p12
- **PEM pass phrase**: Misma contraseña (o una nueva para el archivo .pem)

### En Windows:

Descarga OpenSSL desde: https://slproweb.com/products/Win32OpenSSL.html

Luego en CMD o PowerShell:

```powershell
# Crear directorio
mkdir C:\apple-wallet-certs
cd C:\apple-wallet-certs

# Primero, exporta el certificado desde Windows Certificate Store
# O si tienes los archivos .p12:

# Convertir Pass Type ID Certificate
openssl pkcs12 -in PassCert.p12 -clcerts -nokeys -out signerCert.pem
openssl pkcs12 -in PassCert.p12 -nocerts -out signerKey.pem

# Convertir WWDR
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem

# Push certificates (si los tienes)
openssl pkcs12 -in PushCert.p12 -clcerts -nokeys -out pushCert.pem
openssl pkcs12 -in PushCert.p12 -nocerts -out pushKey.pem
```

---

## Paso 7: Copiar certificados al proyecto

### 7.1 Archivos que debes tener

Después de la conversión, deberías tener:

```
✅ signerCert.pem      (Pass Type ID Certificate)
✅ signerKey.pem       (Pass Type ID Private Key)
✅ wwdr.pem            (Apple WWDR Certificate)
✅ pushCert.pem        (Push Notification Certificate) - opcional
✅ pushKey.pem         (Push Notification Private Key) - opcional
```

### 7.2 Copiar al proyecto

```bash
# En tu proyecto apple-wallet-service
cp ~/Desktop/apple-wallet-certs/*.pem ./certificates/
```

O manualmente:
1. Abre el directorio `certificates/` en tu proyecto
2. Copia los 5 archivos `.pem` ahí

### 7.3 Verificar permisos

```bash
# Los archivos deben ser legibles
chmod 644 certificates/*.pem
```

---

## Paso 8: Configurar variables de entorno

### 8.1 Obtener Team ID

1. Ve a: https://developer.apple.com/account
2. En la sección **Membership details**, verás tu **Team ID**
3. Es un código de 10 caracteres como `ABC123XYZ`
4. **CÓPIALO** - lo necesitas para el .env

### 8.2 Actualizar .env

Edita tu archivo `.env`:

```env
# Apple Developer Configuration
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty  # El que creaste en Paso 1
TEAM_IDENTIFIER=ABC123XYZ                         # Tu Team ID
ORGANIZATION_NAME=Tu Empresa                      # Nombre que aparecerá en el pass
APPLE_PUSH_CERT_PASSWORD=tu-password-aqui        # La contraseña que usaste al exportar el .p12
```

---

## Paso 9: Verificar que todo funciona

### 9.1 Verificar archivos

```bash
# Verificar que los certificados son válidos
cd certificates/

# Ver información del certificado
openssl x509 -in signerCert.pem -text -noout | grep "Subject:"
openssl x509 -in wwdr.pem -text -noout | grep "Subject:"

# Verificar la private key
openssl rsa -in signerKey.pem -check
```

### 9.2 Probar el servicio

```bash
# Iniciar el servicio localmente
npm install
npm start
```

Si ves:
```
✅ Using local certificate files
✅ All required certificates are present
🚀 Apple Wallet Service running on port 3000
```

**¡Éxito! Los certificados están configurados correctamente.**

---

## 🔒 Seguridad

### ⚠️ MUY IMPORTANTE:

1. **NUNCA** subas los archivos `.pem` o `.p12` a Git
2. **NUNCA** los compartas públicamente
3. **NUNCA** los incluyas en screenshots
4. El `.gitignore` ya los excluye automáticamente
5. Para Render, usa las variables de entorno en base64 (ver DEPLOYMENT.md)

### Backup

Guarda una copia segura de:
- Los archivos `.p12` originales
- La contraseña del .p12
- Los archivos `.pem`

En un lugar seguro como:
- Password manager (1Password, LastPass, etc.)
- Drive encriptado
- USB cifrado

---

## 🐛 Troubleshooting

### Error: "No identity found"
- No exportaste la private key junto con el certificado
- Asegúrate de seleccionar AMBOS en Keychain antes de exportar

### Error: "unable to load Private Key"
- La contraseña del .p12 es incorrecta
- O el archivo .pem está corrupto

### Error: "Certificate expired"
- Los certificados de Apple expiran después de un tiempo
- Necesitas renovarlos en Apple Developer Portal

### No puedo instalar el pass en iPhone
- Verifica que `PASS_TYPE_IDENTIFIER` coincide exactamente
- Verifica que `TEAM_IDENTIFIER` es correcto
- Verifica que los certificados no están expirados

### En Windows, OpenSSL no funciona
- Asegúrate de agregarlo al PATH
- O usa la ruta completa: `C:\Program Files\OpenSSL-Win64\bin\openssl.exe`

---

## 📚 Recursos oficiales

- [Apple Wallet Developer Guide](https://developer.apple.com/wallet/)
- [Creating Passes](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Certificates Portal](https://developer.apple.com/account/resources/certificates/)
- [Pass Type IDs Portal](https://developer.apple.com/account/resources/identifiers/list/passTypeId)

---

## ✅ Checklist final

Antes de continuar, verifica que tienes:

- [x] Pass Type ID creado en Apple Developer
- [x] Team ID copiado
- [x] Archivo `signerCert.pem` en `certificates/`
- [x] Archivo `signerKey.pem` en `certificates/`
- [x] Archivo `wwdr.pem` en `certificates/`
- [x] Variables en `.env` configuradas correctamente
- [x] Contraseña del certificado guardada de forma segura
- [x] Servicio Node.js arranca sin errores

Si todos están ✅, ¡estás listo para generar passes!

---

**Next step**: Ve a `DEPLOYMENT.md` para desplegar en Render.
