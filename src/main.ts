import { createApp } from 'vue'
import './style.css'
import './tooltips.css'
import '../cursors.css'
import App from './App.vue'
import { registerGameOverlay } from './lib/gameOverlayRegistry'
import VeilborneGameHost from '../packages/veilborne/ui/VeilborneGameHost.vue'
import { installTooltipManager } from './lib/tooltipManager'

// Composition root: optional game packages are wired here, never inside the editor workspace.
registerGameOverlay({ id: 'veilborne', packageId: 'veilborne_rpg', component: VeilborneGameHost })

installTooltipManager()
createApp(App).mount('#app')
