# 👋 ¡Bienvenido a tu servicio de Apple Wallet!

## 🎉 ¿Qué tienes aquí?

Tienes un **servicio backend completo** para integrar **tarjetas de lealtad de Apple Wallet** con tu aplicación Lovable + Supabase.

### ✅ Características incluidas:

- ✅ Generación de archivos `.pkpass` para Apple Wallet
- ✅ Actualización automática de puntos en tiempo real
- ✅ Notificaciones push cuando cambian los puntos
- ✅ Web Service completo según especificaciones de Apple
- ✅ Integración lista para Lovable + Supabase
- ✅ Deployment automático en Render
- ✅ Código de ejemplo para integrar en tu frontend
- ✅ Documentación completa en español

---

## 🚀 ¿Por dónde empezar?

### Opción 1: Guía Rápida (15 minutos)

Si quieres empezar YA, sigue esta guía:

👉 **[QUICKSTART.md](./QUICKSTART.md)**

Te llevará paso a paso en solo 15 minutos.

### Opción 2: Guía Completa

Si quieres entender todo en detalle:

1. 📖 Lee **[README.md](./README.md)** - Documentación completa
2. 🔐 Sigue **[CERTIFICADOS.md](./CERTIFICADOS.md)** - Obtener certificados de Apple
3. 🚀 Despliega con **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deploy en Render
4. 📂 Revisa **[PROJECT-STRUCTURE.md](./PROJECT-STRUCTURE.md)** - Entender la estructura

---

## 📋 Requisitos previos

Antes de empezar, necesitas:

- ✅ **Cuenta de Apple Developer** ($99/año)
- ✅ **Proyecto en Lovable** funcionando
- ✅ **Acceso a Supabase** (incluido en Lovable)
- ✅ **Cuenta en Render** (gratis para empezar)
- ✅ **Node.js** instalado (para pruebas locales, opcional)

---

## 📁 Archivos importantes

### 📖 Documentación:

- **QUICKSTART.md** ← 🚀 **EMPIEZA AQUÍ** (guía rápida de 15 min)
- **README.md** ← Documentación completa y referencia
- **CERTIFICADOS.md** ← Cómo obtener certificados de Apple
- **DEPLOYMENT.md** ← Cómo desplegar en Render paso a paso
- **PROJECT-STRUCTURE.md** ← Estructura del proyecto explicada

### 💻 Código:

- **src/** ← Código fuente del servicio backend
- **examples/lovable-integration.tsx** ← Código para copiar a Lovable
- **supabase/schema.sql** ← Schema SQL para Supabase

### ⚙️ Configuración:

- **.env.example** ← Template de variables de entorno
- **package.json** ← Dependencias de Node.js
- **render.yaml** ← Configuración para Render

---

## 🎯 Pasos resumidos

### 1️⃣ Obtener certificados de Apple (20 min)

```
1. Crear Pass Type ID en Apple Developer
2. Descargar certificados
3. Convertir a formato .pem
4. Copiar a carpeta certificates/
```

Guía completa: **[CERTIFICADOS.md](./CERTIFICADOS.md)**

### 2️⃣ Configurar Supabase (5 min)

```
1. Ejecutar SQL en Supabase Editor
2. Copiar credenciales de Supabase
```

Archivo: `supabase/schema.sql`

### 3️⃣ Configurar variables de entorno (2 min)

```bash
cp .env.example .env
# Editar .env con tus valores
```

### 4️⃣ Probar localmente (5 min)

```bash
npm install
npm start
# Probar en http://localhost:3000/health
```

### 5️⃣ Desplegar en Render (10 min)

```
1. Subir a GitHub
2. Crear Web Service en Render
3. Configurar variables de entorno
4. Subir certificados en base64
```

Guía completa: **[DEPLOYMENT.md](./DEPLOYMENT.md)**

### 6️⃣ Integrar con Lovable (10 min)

```
1. Copiar código de examples/lovable-integration.tsx
2. Actualizar URL del servicio
3. Usar componentes en tu app
```

---

## 🔍 Vista rápida del proyecto

```
apple-wallet-service/
│
├── 📖 QUICKSTART.md           ← 🚀 EMPIEZA AQUÍ
├── 📖 README.md               ← Documentación completa
├── 📖 CERTIFICADOS.md         ← Guía de certificados
├── 📖 DEPLOYMENT.md           ← Guía de deployment
│
├── 📦 package.json            ← Dependencias
├── 🔧 .env.example            ← Variables de entorno
│
├── 📁 src/                    ← Código fuente
│   ├── index.js              ← Servidor principal
│   ├── config/               ← Configuración
│   ├── routes/               ← Endpoints API
│   ├── services/             ← Lógica de negocio
│   └── templates/            ← Templates de passes
│
├── 📁 certificates/           ← Certificados de Apple
├── 📁 supabase/              ← Schema SQL
├── 📁 examples/              ← Código para Lovable
└── 📁 scripts/               ← Scripts de utilidad
```

---

## 💡 ¿Cómo funciona?

```
┌─────────────┐
│ Lovable App │  Usuario click "Agregar a Wallet"
└──────┬──────┘
       │
       ▼
┌──────────────┐
│   Supabase   │  Almacena puntos y datos
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Render Service│  Genera .pkpass + Push notifications
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Apple Wallet  │  Muestra tarjeta en iPhone
└──────────────┘
```

---

## 🎨 Personalización

Una vez que funcione, puedes personalizar:

### Diseño de la tarjeta:

- Colores (edita `src/services/passGenerator.js`)
- Logo e iconos (agrega PNG a `src/templates/loyalty.pass/`)
- Campos mostrados (modifica estructura en `passGenerator.js`)

### Lógica de puntos:

- Edita `examples/lovable-integration.tsx`
- Modifica función `calculateTier()` para tus niveles
- Ajusta cuántos puntos se otorgan por compra

### Notificaciones:

- Configura webhooks de Supabase (automático)
- O llama al endpoint `/api/webhook/points-updated` manualmente

---

## 🆘 ¿Necesitas ayuda?

### Problemas comunes:

| Problema | Solución |
|----------|----------|
| "Missing Supabase credentials" | Verifica `.env` o variables en Render |
| "Certificate not found" | Verifica archivos `.pem` en `certificates/` |
| Pass no se instala en iPhone | Verifica `PASS_TYPE_IDENTIFIER` y `TEAM_IDENTIFIER` |
| Wallet no se actualiza | Verifica certificados push (`pushCert.pem`) |

### Más ayuda:

- 📖 Revisa la documentación completa
- 🔍 Revisa logs en Render Dashboard
- 🔧 Prueba endpoints con `curl` o Postman

---

## 📚 Recursos adicionales

### Apple:
- [Wallet Developer Guide](https://developer.apple.com/wallet/)
- [PassKit Documentation](https://developer.apple.com/documentation/walletpasses/)
- [Apple Developer Portal](https://developer.apple.com/account/)

### Tu stack:
- [Lovable Documentation](https://lovable.app/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Render Docs](https://render.com/docs)

---

## 💰 Costos

| Servicio | Costo | Notas |
|----------|-------|-------|
| Apple Developer | $99/año | Ya lo tienes ✅ |
| Render Free | $0/mes | Suficiente para empezar |
| Render Starter | $7/mes | Recomendado para producción |
| Supabase | $0/mes | Incluido en Lovable |

**Total inicial: $0/mes** (solo Apple Developer)

---

## ✅ Checklist

Antes de empezar, asegúrate de tener:

- [ ] Cuenta de Apple Developer activa
- [ ] Proyecto Lovable funcionando
- [ ] Acceso a Supabase desde Lovable
- [ ] Cuenta en Render creada
- [ ] 30-60 minutos de tiempo

Una vez que termines:

- [ ] Certificados de Apple obtenidos y convertidos
- [ ] Servicio funcionando localmente
- [ ] Schema SQL ejecutado en Supabase
- [ ] Servicio desplegado en Render
- [ ] Pass de prueba instalado en iPhone
- [ ] Integración funcionando en Lovable

---

## 🚀 ¡Listo para empezar!

**Tu siguiente paso:**

👉 Abre **[QUICKSTART.md](./QUICKSTART.md)** y sigue la guía paso a paso.

En 15 minutos tendrás tu primera tarjeta de lealtad funcionando en Apple Wallet.

---

## 🎉 ¿Qué lograrás?

Cuando termines, tus usuarios podrán:

- ✅ Descargar su tarjeta de lealtad
- ✅ Agregarla a Apple Wallet con un click
- ✅ Ver sus puntos en tiempo real
- ✅ Recibir actualizaciones automáticas cuando compren
- ✅ Escanear código QR en punto de venta (opcional)

Todo esto **automáticamente**, sin que tengan que abrir tu app.

---

**¡Éxito con tu proyecto!** 🚀

¿Preguntas? Revisa la documentación o los ejemplos incluidos.
