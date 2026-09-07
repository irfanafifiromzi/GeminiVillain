import { createApp } from 'vue'
import App from './App.vue'
import { useTheme } from './stores/theme'
import '@xterm/xterm/css/xterm.css'
import './styles/global.css'

// Before mount, so there is no flash of the wrong theme.
useTheme().load()

createApp(App).mount('#app')
