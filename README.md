# Sala de Expedientes

App web para resolver casos criminales: expediente, evidencia, tablero con hilo rojo, notas y acusación con un solo intento por partida.

- Front: HTML, CSS y JavaScript sin build (módulos ES).
- Login: Firebase Authentication (correo y contraseña, sin registro público).
- Datos: Cloud Firestore. Los casos viven en la colección `casos` y el progreso en `usuarios/{uid}/progreso`. Los casos **no** están en este repositorio.
- Publicación: GitHub Pages desde la rama `main`.

## Estructura

```
index.html            página
estilos.css           estilos
app.js                lógica, login y Firestore
arte.js               ilustraciones SVG de evidencia
firestore.rules       reglas de seguridad (pegar en la consola de Firebase)
manifest.webmanifest  para instalar en el iPhone
icons/                íconos
```

## Agregar casos

Desde la app: **Importar caso (.json)**. El archivo se valida y se guarda en Firestore.

Formato resumido de un caso:

```json
{
  "id": "mi-caso",
  "titulo": "El caso X",
  "exp": "Expediente #001 · Ciudad",
  "dificultad": "Media",
  "orden": 1,
  "pregunta": "¿Quién mató a X?",
  "carta": ["párrafo", "párrafo"],
  "firma": "Detective",
  "victima": { "nombre": "", "detalle": "", "datos": [["Edad", "20"]] },
  "personas": [{ "id": "ana", "nombre": "Ana Pérez", "edad": 30, "rol": "", "detalles": [""], "alias": [""] }],
  "cronologia": [["15:00", "texto"]],
  "interrogatorios": { "ana": [["pregunta", "respuesta"]] },
  "evidencias": [{ "id": "e1", "art": "documento", "etq": "E-01 · Tipo", "titulo": "", "lugar": "", "body": [""], "chat": [["Quién", "hora", "texto"]], "doc": [["clave", "valor"]], "lock": false }],
  "culpables": ["ana"],
  "solucion": { "resumen": "", "puntos": [""], "motivo": "" }
}
```

Las evidencias con `"lock": true` se desbloquean al leer todos los interrogatorios. `art` puede ser cualquier ilustración de `arte.js`, o se puede usar `"img"` con una imagen en data URI.
