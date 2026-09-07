import { backend, invoke } from '@/lib/backend'

export const openFolder = (path: string) => invoke<void>('open_folder', { path })
export const openInVscode = (path: string) => invoke<void>('open_in_vscode', { path })
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path })

export const loadProjects = <T,>() => invoke<T>('projects_load')
export const saveProjects = <T,>(projects: T) => invoke<void>('projects_save', { projects })

export const minimizeWindow = async () => (await backend()).minimize()
export const toggleMaximizeWindow = async () => (await backend()).toggleMaximize()
export const closeWindow = async () => (await backend()).close()

export const pickDirectory = async (title = 'Select project folder') =>
  (await backend()).pickDirectory(title)

export const pickFile = async (title = 'Select a file') => (await backend()).pickFile(title)

export const hasSsh = () => invoke<boolean>('has_ssh')

/** Last path segment, for defaulting a project name from its folder. */
export const basename = (path: string): string =>
  path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
