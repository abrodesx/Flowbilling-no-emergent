# FakturaFlow — App Escritorio (Windows / macOS / Linux)

App nativa que envuelve FakturaFlow con Electron. Genera un instalador `.exe` (Windows), `.dmg` (Mac) o `.AppImage` (Linux).

## ⚡ Requisitos previos

- **Node.js 18+** y **Yarn** (o npm)
- Para compilar a Windows desde otro SO: instalar [Wine](https://wiki.winehq.org/Download)
- Para compilar a Windows desde Windows: nada extra

## 🚀 Generar el `.exe` (Windows)

1. Copia o clona el repo en tu PC con Windows.
2. Abre PowerShell o CMD en la carpeta `electron/`:
   ```powershell
   cd electron
   ```
3. Instala dependencias:
   ```powershell
   yarn install
   ```
4. Genera el instalador:
   ```powershell
   yarn dist:win
   ```
5. El instalador aparece en `electron/dist/FakturaFlow Setup 1.0.0.exe`.
6. Doble click → instala → atajo de escritorio + menú inicio con el icono FakturaFlow.

## 🍎 macOS

```bash
yarn dist:mac
# → dist/FakturaFlow-1.0.0.dmg
```

## 🐧 Linux

```bash
yarn dist:linux
# → dist/FakturaFlow-1.0.0.AppImage  +  .deb
```

## 🔧 Configurar URL de backend

La app por defecto se conecta a `https://flow-billing-4.preview.emergentagent.com`.

Cuando despliegues a producción con tu dominio, edita `main.js` línea 7:
```js
const APP_URL = process.env.FAKTURAFLOW_URL || "https://TU-DOMINIO.com";
```

O lanza la app con variable de entorno (sin recompilar):
```powershell
$env:FAKTURAFLOW_URL="https://tudominio.com"; .\FakturaFlow.exe
```

## 🧪 Probar sin empaquetar (modo dev)

```bash
yarn install
yarn start
```

## 🔑 Acceso Owner — Acceso total GRATIS

El usuario `s.abrodex@gmail.com` está configurado como **Owner** en el backend (variable `OWNER_EMAIL` en `/app/backend/.env`).

Al iniciar sesión con ese email obtienes automáticamente:
- ✅ Plan **Business unlimited** activo
- ✅ Sin límites de facturas, perfiles o módulos premium
- ✅ Badge **"Modo Owner · Acceso total"** en `/app/planes`

Para añadir más owners, edita `OWNER_EMAIL` (separa con comas):
```
OWNER_EMAIL=s.abrodex@gmail.com,otro@email.com
```

## 📦 Icono

`build/icon.png` (512×512). Para Windows también puedes generar un `icon.ico` con [icoconvert.com](https://icoconvert.com) y reemplazar:
```json
"win": { "icon": "build/icon.ico" }
```

## 🔌 Modo offline (PWA)

La app web ya tiene service worker (`/sw.js`) y `manifest.json` configurados, así que también funciona offline para navegación básica (las APIs requieren conexión).
