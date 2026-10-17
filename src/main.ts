import { createApp } from 'vue'
import './style.css'
import './tooltips.css'
import '../cursors.css'
import App from './App.vue'
import { installTooltipManager } from './lib/tooltipManager'

installTooltipManager()
createApp(App).mount('#app')
