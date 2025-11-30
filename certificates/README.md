# Certificados de Apple Developer

Este directorio debe contener los certificados necesarios para firmar los passes de Apple Wallet y enviar notificaciones push.

## Archivos requeridos:

### 1. Para firmar passes (.pkpass):
- `wwdr.pem` - Apple Worldwide Developer Relations Certificate
- `signerCert.pem` - Pass Type ID Certificate (convertido a PEM)
- `signerKey.pem` - Private Key del Pass Type ID Certificate

### 2. Para notificaciones push:
- `pushCert.pem` - Apple Push Notification Certificate (convertido a PEM)
- `pushKey.pem` - Private Key del Push Certificate

## Cómo obtener y convertir los certificados:

### Paso 1: Crear Pass Type ID
1. Ve a https://developer.apple.com/account/resources/identifiers/list/passTypeId
2. Crea un nuevo Pass Type ID (ej: `pass.com.tuempresa.loyalty`)
3. Descarga el certificado (.cer)

### Paso 2: Descargar WWDR Certificate
1. Ve a https://www.apple.com/certificateauthority/
2. Descarga "Worldwide Developer Relations - G4" (.cer)

### Paso 3: Convertir certificados a PEM

#### En macOS/Linux:

```bash
# 1. Exportar el certificado Pass Type ID desde Keychain
# Keychain Access > My Certificates > Pass Type ID Certificate
# Exportar como .p12 (incluir private key, usar password)

# 2. Convertir Pass Type ID Certificate a PEM
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out signerCert.pem -passin pass:TU_PASSWORD

# 3. Convertir Private Key a PEM
openssl pkcs12 -in Certificates.p12 -nocerts -out signerKey.pem -passin pass:TU_PASSWORD -passout pass:TU_PASSWORD

# 4. Convertir WWDR Certificate a PEM
openssl x509 -inform DER -in AppleWWDRCA.cer -out wwdr.pem

# 5. Para Push Notifications (similar al proceso anterior)
# Crear Apple Push Notification Certificate en developer.apple.com
# Exportar como .p12 desde Keychain
openssl pkcs12 -in PushCert.p12 -clcerts -nokeys -out pushCert.pem -passin pass:TU_PASSWORD
openssl pkcs12 -in PushCert.p12 -nocerts -out pushKey.pem -passin pass:TU_PASSWORD -passout pass:TU_PASSWORD
```

#### En Windows:

Puedes usar OpenSSL para Windows:
- Descarga desde: https://slproweb.com/products/Win32OpenSSL.html
- Usa los mismos comandos de arriba en CMD o PowerShell

### Paso 4: Colocar archivos en este directorio

```
certificates/
├── wwdr.pem
├── signerCert.pem
├── signerKey.pem
├── pushCert.pem
└── pushKey.pem
```

## IMPORTANTE:

⚠️ **NUNCA subas estos archivos a Git o repositorios públicos**
- Los archivos .pem están excluidos en .gitignore
- Usa variables de entorno en producción
- En Render, sube los archivos manualmente o usa secretos

## Verificar certificados:

```bash
# Verificar que los archivos son válidos
openssl x509 -in signerCert.pem -text -noout
openssl rsa -in signerKey.pem -check
openssl x509 -in wwdr.pem -text -noout
```

## Configurar en .env:

```
PASS_TYPE_IDENTIFIER=pass.com.tuempresa.loyalty
TEAM_IDENTIFIER=ABC123XYZ
APPLE_PUSH_CERT_PASSWORD=tu-password-aqui
```
