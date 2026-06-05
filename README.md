<div align="center">
  <h1>Biblioteca</h1>
  <p><em>App de lectura personal, basada en Readest</em></p>
  <br>
</div>

**Biblioteca** es una aplicación de lectura de ebooks para **Arch Linux** (y otros escritorios), construida a partir de [**Readest**](https://github.com/readest/readest) — un lector open-source moderno construido con [Next.js 16](https://github.com/vercel/next.js) y [Tauri v2](https://github.com/tauri-apps/tauri).

Biblioteca parte del código de Readest como base técnica, pero se desarrolla como un proyecto independiente con su propio rumbo, prioridades e identidad.

---

## Estado actual

| Aspecto | Detalle |
|---------|---------|
| Versión | **v0.90.0** |
| Basado en | Readest v0.11.x |
| Plataforma objetivo | Arch Linux (escritorio) |
| Licencia | AGPL-3.0 |
| Repositorio | Privado — sin remoto público |

---

## Tecnología

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript + TailwindCSS |
| Estado | Zustand 5 |
| Backend nativo | Rust + Tauri v2 |
| Motor de libros | foliate-js (EPUB, MOBI, PDF, CBZ, FB2, TXT) |
| Motor de búsqueda | Lunr |

---

## Características

- **Multiformato**: EPUB, MOBI, KF8 (AZW3), FB2, CBZ, TXT, PDF
- **Modos de lectura**: Scroll y paginado
- **Búsqueda**: Texto completo dentro del libro
- **Anotaciones**: Subrayados, marcadores, notas
- **Traducción**: DeepL, Yandex y otros proveedores
- **Text-to-Speech**: Narración multilingüe
- **Paralelo**: Lectura simultánea de dos libros en pantalla dividida
- **Personalización**: Fuentes, temas, layouts
- **Sincronización**: WebDAV, KOReader, OPDS/Calibre
- **Integración con Diccionario**: Módulo propio de vocabulario personal

---

## Requisitos para compilar en Arch Linux

```bash
# Dependencias del sistema
sudo pacman -S base-devel rust cargo pkgconf webkit2gtk-4.1 libsoup3

# Gestor de paquetes JS
npm install -g pnpm
```

---

## Getting Started

```bash
# Clonar (si alguna vez se sube a un remoto)
git clone <repo-url>
cd Biblioteca

# Inicializar submódulos
git submodule update --init --recursive

# Instalar dependencias JS
pnpm install

# Copiar vendors (PDF.js, simplecc, jieba)
pnpm --filter @readest/readest-app setup-vendors

# Desarrollo web (sin compilar Rust)
pnpm dev-web

# Desarrollo escritorio (Tauri)
pnpm tauri dev

# Build producción
dotenv -e apps/readest-app/.env.tauri.local -- pnpm --filter @readest/readest-app tauri build
```

Para más detalles técnicos, consultar la documentación en `apps/readest-app/docs/`.

---

## Créditos

Biblioteca está construido sobre **Readest**, un lector de ebooks open-source creado por [Bilingify LLC](https://github.com/readest) y su comunidad. Readest es a su vez una reescritura moderna de [Foliate](https://github.com/johnfactotum/foliate) de John Factotum.

Sin el trabajo de esos proyectos, Biblioteca no existiría.

---

## Licencia

Biblioteca es software libre: puede redistribuirse y/o modificarse bajo los términos de la [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) según lo publicado por la Free Software Foundation, ya sea la versión 3 de la Licencia o (a su elección) cualquier versión posterior. Consulte el archivo [LICENSE](LICENSE) para más detalles.

### Licencias de terceros

- [foliate-js](https://github.com/johnfactotum/foliate-js) — MIT
- [zip.js](https://github.com/gildas-lormeau/zip.js) — BSD-3-Clause
- [fflate](https://github.com/101arrowz/fflate) — MIT
- [PDF.js](https://github.com/mozilla/pdf.js) — Apache License 2.0
- [daisyUI](https://github.com/saadeghi/daisyui) — MIT
- [marked](https://github.com/markedjs/marked) — MIT
- [next.js](https://github.com/vercel/next.js) — MIT
- [react](https://github.com/facebook/react) — MIT
- [tauri](https://github.com/tauri-apps/tauri) — MIT

---

<div align="center" style="color: gray;">Built with ❤️ for deep reading.</div>
