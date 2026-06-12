# FakturaFlow — PRD

## Stack
- Frontend: React 19 + Tailwind + shadcn/ui + Recharts
- Backend: FastAPI + Motor + bcrypt + PyJWT + reportlab + pypdfium2 + zipfile
- AI: Groq API (vision: llama-4-scout, text: llama-3.3-70b)
- Auth: JWT cookies httpOnly

## Implementado

### Iteración 1 (10 Feb 2026) — MVP — 25/25 tests
Auth, Dashboard, Clientes, Facturas+PDF, Gastos+OCR, Reportes, Calendario fiscal, Búsqueda global, claro/oscuro.

### Iteración 2 — Fase 1 — 47/47 tests
PDF OCR + cámara móvil, Contabilidad (libros), Presupuestos→factura, Rectificativas, Cobros parciales, IA conversacional, Panel fiscal inteligente.

### Iteración 11 — Importación con IA + Nº Pedido (1 Jun 2026) ✅
- **Importar con IA** (`/app/importar-ia`): nuevo endpoint `POST /api/ai/import-invoice` (multipart). Acepta PDF/PNG/JPG hasta 10MB, lo procesa con Groq Vision y extrae estructuradamente: serie, número, fechas, cliente, NIF, conceptos (cantidad/precio/IVA/IRPF/descuento), nº pedido, observaciones.
- Flujo en 2 pasos: 1) `save=false` previsualiza → usuario revisa/edita; 2) `save=true` crea factura o presupuesto. Si el cliente no existe se crea automáticamente. Tag automático `importada-ia`.
- **Nº Pedido** opcional añadido al modelo InvoiceIn, al editor `/app/facturas/nueva` y aparece en el PDF junto a fecha/vencimiento.

### Iteración 10 — Personalización facturas (1 Jun 2026) ✅
- **Número de factura editable** manualmente al crear o editar (validación de unicidad por perfil). Si se deja vacío se auto-genera.
- **Toggle QR Verifactu** en PDF: dropdown "Descargar PDF (con/sin QR)" en lista de facturas. Endpoint `GET /api/invoices/{id}/pdf?show_qr=true|false`.
- **Datos bancarios** (IBAN + banco + SWIFT) en perfil. Sección "Datos bancarios" en `/app/configuracion`. Aparecen automáticamente en PDF debajo de observaciones.
- **Eliminadas referencias a FakturaFlow** del PDF (footer "Documento generado por FakturaFlow · fakturaflow.es" y disclaimer AEAT cambiado a "Borrador interno").

### Iteración 9 — App 100% gratis + badge eliminado (1 Jun 2026) ✅
- Eliminado sistema de pagos: borrado /app/pages/Subscription.js, ruta /app/planes, link sidebar "Planes" y CommandPalette.
- `/api/subscription` ahora siempre devuelve "Acceso completo" sin límites para todos los usuarios.
- Endpoints Stripe (`/checkout`, `/checkout-status`, `/webhook`, `/cancel`, `/plans`) eliminados del backend.
- Quitado el badge "Made with Emergent" de `/app/frontend/public/index.html` (link, SVG y estilos).

### Iteración 8 — Lote 7-features (1 Jun 2026) — 31/31 tests ✅
- **Logo empresa** en PDF facturas/presupuestos (upload base64 desde Settings).
- **CSV import/export** (clientes, facturas, gastos) con auto-creación de clientes.
- **Búsqueda avanzada** con filtros (fechas, importes, estado, etiquetas) en /app/buscar.
- **Audit log** automático (create/update/delete + import) en /app/auditoria.
- **Plantillas de email** personalizables con variables {{cliente}}, {{numero}}, etc. y preview.
- **Portal del gestor** (read-only token público) en /gestor/{token}: stats anuales/trimestrales + listados.
- **Generador de contratos PDF** desde presupuestos con 8 cláusulas estándar.
- **Firma digital**: visual (sello con hash) + cripto PAdES con certificado .p12/.pfx (FNMT/DNIe), validado con cert de prueba.

Bug encontrado y corregido por testing agent: pyhanko API (`load_pkcs12` → `load_pkcs12_data` + `async_sign_pdf`). 

### Iteración 7 — Logo empresa + Fix public quote (31 May 2026) ✅
- **Logo de empresa**: campo `logo_url` ahora acepta data URI (base64). Settings tiene uploader con preview (PNG/JPG/SVG hasta 2MB). PDF de facturas y presupuestos incluye el logo arriba a la derecha automáticamente. También admite URLs http externas.
- **Fix**: `/api/public/quote/{token}` ahora resuelve el emisor correctamente (antes devolvía null).

### Iteración 6 — Owner mode + Verifactu + Electron (21 Feb 2026) ✅
- **Owner mode**: variable `OWNER_EMAIL` en backend/.env. Usuarios listados ahí obtienen plan Business unlimited sin Stripe. Helper `is_owner(user)` + `/api/subscription` devuelve `owner: true`. Badge "Modo Owner · Acceso total" en /app/planes.
- **Verifactu (RD 1007/2023)**: hash SHA-256 encadenado al crear cualquier factura no-borrador, QR de verificación insertado en PDF, página `/app/verifactu` con cadena inmutable de eventos. Endpoints: `POST /api/invoices/{id}/verifactu` (firma manual), `GET /api/verifactu/chain` (cadena), `GET /api/public/verifactu/{uuid}` (verificación pública).
- **Electron desktop wrapper** en `/app/electron/`: main.js + package.json + electron-builder configurado para `.exe` (NSIS), `.dmg` y `.AppImage`. Iconos en `build/icon.png`. README con instrucciones detalladas. Owner s.abrodex@gmail.com obtiene acceso total al loguearse en la app desktop.

### Iteración 5 — Fase 3 (21 Feb 2026) — 100% backend (20/20) + 100% frontend (8/8) ✅
- **Stripe suscripciones**: planes Free/Pro/Business; checkout vía /api/subscription/checkout; cancel; polling de estado de pago. UI en /app/planes.
- **Modo Asesor IA**: análisis pre-trimestre (Groq llama-3.3-70b) + checks automáticos (facturas vencidas, IVA, NIF, etc.) en /app/asesor.
- **Salud del negocio**: dashboard de KPIs (Liquidez, Crecimiento, Diversificación, Estabilidad) con score global, en /app/salud.
- **Recordatorios inteligentes**: campana en header (ReminderBell) con polling 5min de /api/reminders.
- **Command Palette (⌘K)**: navegación + acciones rápidas, accesible con DialogTitle/Description (a11y).
- **Portal cliente público**: /public/quote/:token (sin auth) para aceptar/rechazar presupuestos.
- Backend endpoints: /api/subscription/*, /api/ai/advisor-review, /api/analytics/health, /api/reminders, /api/public/quote/*.

### Iteración 3 — Fase 2 maximalista (10 Feb 2026) — 71/71 tests ✅
- **Multi-empresa**: perfiles ilimitados (autónomo/SL/freelance) con datos fiscales independientes; selector arriba en sidebar; X-Profile-Id header scope completo de TODAS las colecciones; migración automática de datos legacy.
- **Modelos AEAT borrador**: 303 (IVA trimestral), 130 (IRPF pago fraccionado), 390 (resumen anual IVA) en PDF estilo oficial.
- **ZIP "Preparar trimestre"**: descarga única con libros CSV (ingresos/gastos/IVA rep/IVA sop) + Modelos 303 + 130 PDF + facturas individuales + resumen JSON.
- **Proyectos**: cliente vinculado, presupuesto, €/hora, color, estado activo/pausado/completado, agregación de horas+facturas+gastos.
- **Control horario**: cronómetro live + entradas manuales + selección múltiple → factura con un clic.
- **Sistema documental**: subida base64 en MongoDB (4MB), vinculado a cliente/factura/gasto/presupuesto/proyecto.
- **Tags universales**: en clientes, facturas, gastos. Endpoint `/tags?entity=` agrega + cuenta.

## Backlog (post Fase 3 + Owner/Verifactu/Electron)
- Verifactu real-time push a AEAT (requiere certificado digital del usuario)
- Auto-update Electron app (electron-updater + GitHub releases)
- Firma digital criptográfica embebida en PDFs (PAdES)
- Email integration real (Resend) con plantillas + tracking
- OCR avanzado: detección duplicados + IVA faltante + simplificadas
- Backups automáticos (ZIP/JSON/CSV programados)

## Mejoras técnicas opcionales
- Splitear server.py (1685 líneas) en routers
- Cascade delete o validación al eliminar perfiles con datos
- GridFS o object storage externo para documentos >4MB
- Atomic set-default profile
- Validación de entity_id en upload de documentos
- Honrar default_iva/series del perfil en convert-to-invoice
- Migración con flag por usuario (no recorrer todos en startup)

## Test Credentials
Ver `/app/memory/test_credentials.md`
