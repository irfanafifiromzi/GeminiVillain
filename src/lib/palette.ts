/**
 * Shared between the palette and whoever fills it.
 *
 * Lives in its own module rather than being exported from `<script setup>`,
 * which cannot carry ES exports.
 */
export interface PaletteItem {
  id: string
  /** What you type to find it. */
  label: string
  /** Where it belongs: project, command, workflow, server, action. */
  kind: string
  /** The quiet second line: a path, a command line, a host. */
  detail?: string
  run: () => void
}
