import { createApp } from 'vue'
import App from '../../src/App.vue'
import { installTooltipManager } from '../../src/lib/tooltipManager'

installTooltipManager()
createApp(App).mount('#app')
