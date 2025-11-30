# PowerShell script para convertir certificados a base64
# Versión para Windows

Write-Host "🔐 Converting Apple Wallet Certificates to Base64" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "certificates")) {
    Write-Host "❌ Error: certificates/ directory not found" -ForegroundColor Red
    Write-Host "Run this script from the project root directory" -ForegroundColor Red
    exit 1
}

# Crear directorio para archivos base64
New-Item -ItemType Directory -Force -Path "certificates\base64" | Out-Null
Set-Location "certificates"

Write-Host "Converting certificates..." -ForegroundColor Green
Write-Host ""

# Función para convertir y mostrar
function Convert-Cert {
    param(
        [string]$file,
        [string]$varName
    )

    if (Test-Path $file) {
        Write-Host "✅ Converting $file..." -ForegroundColor Green

        # Leer archivo y convertir a base64
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $base64 = [System.Convert]::ToBase64String($bytes)

        # Guardar en archivo
        $base64 | Out-File -FilePath "base64\$file.base64.txt" -Encoding ASCII

        Write-Host ""
        Write-Host "────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host "Variable name for Render: $varName" -ForegroundColor Cyan
        Write-Host "────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Copy this value to Render Environment Variables:" -ForegroundColor White
        Write-Host ""
        Write-Host $base64 -ForegroundColor Gray
        Write-Host ""
        Write-Host "────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "⚠️  Warning: $file not found, skipping..." -ForegroundColor Yellow
        Write-Host ""
    }
}

# Convertir cada certificado
Convert-Cert -file "wwdr.pem" -varName "CERT_WWDR_BASE64"
Convert-Cert -file "signerCert.pem" -varName "CERT_SIGNER_BASE64"
Convert-Cert -file "signerKey.pem" -varName "CERT_SIGNER_KEY_BASE64"
Convert-Cert -file "pushCert.pem" -varName "CERT_PUSH_BASE64"
Convert-Cert -file "pushKey.pem" -varName "CERT_PUSH_KEY_BASE64"

Write-Host ""
Write-Host "✅ Done! Base64 files saved in certificates\base64\" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Go to Render Dashboard → Your Service → Environment"
Write-Host "2. Add each variable shown above with its base64 value"
Write-Host "3. Save changes and redeploy"
Write-Host ""
Write-Host "🔒 Security reminder:" -ForegroundColor Red
Write-Host "- DO NOT commit base64 files to git"
Write-Host "- DO NOT share these values publicly"
Write-Host "- Store them securely in Render only"
Write-Host ""

# Volver al directorio raíz
Set-Location ..
