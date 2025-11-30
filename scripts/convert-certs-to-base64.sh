#!/bin/bash

# Script para convertir certificados a base64
# Útil para deployment en Render u otros servicios cloud

echo "🔐 Converting Apple Wallet Certificates to Base64"
echo "=================================================="
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -d "certificates" ]; then
  echo "❌ Error: certificates/ directory not found"
  echo "Run this script from the project root directory"
  exit 1
fi

# Crear directorio para archivos base64
mkdir -p certificates/base64
cd certificates

echo "Converting certificates..."
echo ""

# Función para convertir y mostrar
convert_cert() {
  local file=$1
  local var_name=$2

  if [ -f "$file" ]; then
    echo "✅ Converting $file..."
    base64 -i "$file" > "base64/${file}.base64.txt"

    echo ""
    echo "────────────────────────────────────────────────"
    echo "Variable name for Render: ${var_name}"
    echo "────────────────────────────────────────────────"
    echo ""
    echo "Copy this value to Render Environment Variables:"
    echo ""
    cat "base64/${file}.base64.txt"
    echo ""
    echo "────────────────────────────────────────────────"
    echo ""
  else
    echo "⚠️  Warning: $file not found, skipping..."
    echo ""
  fi
}

# Convertir cada certificado
convert_cert "wwdr.pem" "CERT_WWDR_BASE64"
convert_cert "signerCert.pem" "CERT_SIGNER_BASE64"
convert_cert "signerKey.pem" "CERT_SIGNER_KEY_BASE64"
convert_cert "pushCert.pem" "CERT_PUSH_BASE64"
convert_cert "pushKey.pem" "CERT_PUSH_KEY_BASE64"

echo ""
echo "✅ Done! Base64 files saved in certificates/base64/"
echo ""
echo "📋 Next steps:"
echo "1. Go to Render Dashboard → Your Service → Environment"
echo "2. Add each variable shown above with its base64 value"
echo "3. Save changes and redeploy"
echo ""
echo "🔒 Security reminder:"
echo "- DO NOT commit base64 files to git"
echo "- DO NOT share these values publicly"
echo "- Store them securely in Render only"
echo ""
