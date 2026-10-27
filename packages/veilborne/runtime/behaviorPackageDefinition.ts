import { registerBehaviorPackageDefinition } from '../../../engine/script/packages.ts'
import type { BehaviorPackageDefinition } from '../../../engine/script/packages.ts'
import { VEILBORNE_RUNTIME_ITEMS } from './VeilborneCombat.ts'
import { VEILBORNE_AI_PROFILES, VEILBORNE_AI_PROFILE_OPTIONS } from './VeilborneAIProfiles.ts'

const VEILBORNE_ITEM_IDS = Object.keys(VEILBORNE_RUNTIME_ITEMS)

/** Definição de comportamento pertencente exclusivamente ao jogo VEILBORNE. */
export const VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION: BehaviorPackageDefinition = {
    id: 'veilborne_rpg',
    version: '0.1.0',
    name: 'VEILBORNE — RPG Sombrio',
    description: 'Base modular de RPG medieval sombrio para magos guerreiros: atributos, armas, éter, vigor, postura, feitiços, sigilos, inimigos e progressão.',
    variables: [
      { name: 'level', label: 'Nível', type: 'number', defaultValue: 1, description: 'Nível atual do personagem.', min: 1, max: 999, step: 1 },
      { name: 'vida', label: 'Vida atual', type: 'number', defaultValue: 100, description: 'Pontos de vida atuais do personagem.', min: 0, max: 999999, step: 1 },
      { name: 'vida_max', label: 'Vida máxima', type: 'number', defaultValue: 100, description: 'Limite de vida antes de aplicar bônus de equipamento.', min: 1, max: 999999, step: 1 },
      { name: 'eter', label: 'Éter atual', type: 'number', defaultValue: 100, description: 'Recurso gasto para lançar feitiços e ativar sigilos.', min: 0, max: 999999, step: 1 },
      { name: 'eter_max', label: 'Éter máximo', type: 'number', defaultValue: 100, description: 'Capacidade máxima de éter.', min: 1, max: 999999, step: 1 },
      { name: 'vigor', label: 'Vigor atual', type: 'number', defaultValue: 100, description: 'Recurso para esquivas, bloqueios e ataques físicos.', min: 0, max: 999999, step: 1 },
      { name: 'vigor_max', label: 'Vigor máximo', type: 'number', defaultValue: 100, description: 'Capacidade máxima de vigor.', min: 1, max: 999999, step: 1 },
      { name: 'postura', label: 'Postura', type: 'number', defaultValue: 0, description: 'Dano de postura acumulado; ao atingir postura_max, o alvo pode ser atordoado.', min: 0, max: 999999, step: 1 },
      { name: 'postura_max', label: 'Postura para quebra', type: 'number', defaultValue: 100, description: 'Limite de postura para atordoamento.', min: 1, max: 999999, step: 1 },
      { name: 'forca', label: 'Força', type: 'number', defaultValue: 10, description: 'Escala o dano de armas pesadas e ataques físicos.', min: 1, max: 999, step: 1 },
      { name: 'destreza', label: 'Destreza', type: 'number', defaultValue: 10, description: 'Escala armas rápidas e pode melhorar a velocidade de ataque.', min: 1, max: 999, step: 1 },
      { name: 'intelecto', label: 'Intelecto', type: 'number', defaultValue: 10, description: 'Escala poder mágico e capacidade de éter.', min: 1, max: 999, step: 1 },
      { name: 'vontade', label: 'Vontade', type: 'number', defaultValue: 10, description: 'Escala sigilos e resistência a efeitos sobrenaturais.', min: 1, max: 999, step: 1 },
      { name: 'resistencia', label: 'Resistência', type: 'number', defaultValue: 10, description: 'Escala defesa física, vitalidade e resistência elemental.', min: 1, max: 999, step: 1 },
      { name: 'ecos', label: 'Ecos', type: 'number', defaultValue: 0, description: 'Recurso de progressão carregado pelo personagem.', min: 0, max: 999999999, step: 1 },
      { name: 'alvo_travado', label: 'Alvo travado', type: 'boolean', defaultValue: false, description: 'Indica se o sistema de combate está travado em um alvo.' },
      { name: 'morto', label: 'Morto', type: 'boolean', defaultValue: false, description: 'Estado de morte do personagem; o runtime deve definir e limpar este valor.' },
      { name: 'faction', label: 'Facção', type: 'string', defaultValue: 'hostile', description: 'Alvos com a facção hostile podem ser atacados pelo jogador; use neutral ou player para excluir do combate padrão.' },
      { name: 'res_fisica', label: 'Resistência física (%)', type: 'number', defaultValue: 0, description: 'Resistência a ataques de armas físicas.', min: -100, max: 95, step: 1 },
      { name: 'res_chama', label: 'Resistência à chama (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia de fogo.', min: -100, max: 95, step: 1 },
      { name: 'res_geada', label: 'Resistência à geada (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia de gelo.', min: -100, max: 95, step: 1 },
      { name: 'res_tempestade', label: 'Resistência à tempestade (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia elétrica.', min: -100, max: 95, step: 1 },
      { name: 'res_sangue', label: 'Resistência ao sangue (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia de sangue.', min: -100, max: 95, step: 1 },
      { name: 'res_sombra', label: 'Resistência à sombra (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia sombria.', min: -100, max: 95, step: 1 },
      { name: 'res_espirito', label: 'Resistência espiritual (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia espiritual.', min: -100, max: 95, step: 1 },
      { name: 'res_arcano', label: 'Resistência arcana (%)', type: 'number', defaultValue: 0, description: 'Resistência a magia arcana.', min: -100, max: 95, step: 1 },
      { name: 'ai_enabled', label: 'IA ativa', type: 'boolean', defaultValue: true, description: 'Permite que este objeto persiga e ataque o jogador durante a execução.' },
      { name: 'ai_custom_stats', label: 'Usar atributos de IA personalizados', type: 'boolean', defaultValue: false, description: 'Quando ativado, usa alcance, velocidade, dano, tipo de dano e recarga informados manualmente.' },
      { name: 'ai_profile', label: 'Perfil de IA', type: 'string', defaultValue: 'melee', description: 'Preset de combate configurável por instância.', options: [...VEILBORNE_AI_PROFILE_OPTIONS] },
      { name: 'ai_state', label: 'Estado da IA', type: 'string', defaultValue: 'idle', description: 'Estado atual: idle, pursue, attack, recover ou dead.', readOnly: true },
      { name: 'perception_range', label: 'Alcance de percepção', type: 'number', defaultValue: 18, description: 'Distância máxima para detectar o jogador.', min: 1, max: 60, step: 0.5 },
      { name: 'attack_range', label: 'Alcance de ataque', type: 'number', defaultValue: 2, description: 'Distância horizontal para iniciar um ataque.', min: 0.5, max: 40, step: 0.1 },
      { name: 'move_speed', label: 'Velocidade de movimento da IA', type: 'number', defaultValue: 2.8, description: 'Velocidade de perseguição em unidades por segundo.', min: 0, max: 15, step: 0.1 },
      { name: 'attack_damage', label: 'Dano base da IA', type: 'number', defaultValue: 12, description: 'Dano base por golpe inimigo antes de resistências do jogador.', min: 0, max: 99999, step: 1 },
      { name: 'attack_damage_type', label: 'Tipo de dano da IA', type: 'string', defaultValue: 'physical', description: 'physical, fire, frost, storm, blood, shadow, spirit ou arcane.' },
      { name: 'attack_cooldown', label: 'Recarga de ataque da IA', type: 'number', defaultValue: 1.4, description: 'Tempo mínimo entre dois golpes, em segundos.', min: 0.2, max: 30, step: 0.1 },
      { name: 'attack_posture_damage', label: 'Dano de postura da IA', type: 'number', defaultValue: 8, description: 'Postura que o golpe acumula no jogador.', min: 0, max: 99999, step: 1 },
      { name: 'boss_phase', label: 'Fase do chefe', type: 'number', defaultValue: 1, description: 'Fase atual calculada pela vida restante.', min: 1, max: 3, step: 1, readOnly: true },
      { name: 'ai_damage_multiplier', label: 'Multiplicador de dano da IA', type: 'number', defaultValue: 1, description: 'Multiplicador configurado por scripts de comportamento.', min: 0, max: 10, step: 0.05, readOnly: true },
      { name: 'eco_reward', label: 'Recompensa em Ecos', type: 'number', defaultValue: -1, description: 'Ecos concedidos ao derrotar este inimigo. -1 usa a recompensa automática do perfil; 0 desativa a recompensa.', min: -1, max: 1000000, step: 1 },
      { name: 'xp_reward', label: 'Recompensa de experiência', type: 'number', defaultValue: -1, description: 'Experiência concedida ao derrotar este inimigo. -1 usa a recompensa automática do perfil; 0 desativa a recompensa.', min: -1, max: 1000000, step: 1 },
      { name: 'entity_role', label: 'Função VEILBORNE', type: 'string', defaultValue: 'combatant', description: 'combatant para inimigos/personagens ou loot para objetos coletáveis.' },
      { name: 'loot_item_id', label: 'ID do item coletável', type: 'string', defaultValue: 'lesser_vitality_vial', description: 'ID do item que o jogador recebe ao interagir com este objeto configurado como loot.' },
      { name: 'loot_quantity', label: 'Quantidade coletável', type: 'number', defaultValue: 1, description: 'Quantidade de itens recebida ao coletar este objeto.', min: 1, max: 99, step: 1 },
      { name: 'loot_collected', label: 'Já coletado', type: 'boolean', defaultValue: false, description: 'Estado usado pelo runtime para evitar coleta repetida.', readOnly: true },
      { name: 'loot_original_visible', label: 'Visibilidade original do loot', type: 'boolean', defaultValue: true, description: 'Estado temporário usado para restaurar itens coletados ao voltar ao editor.', readOnly: true },
      { name: 'loot_spawned', label: 'Drop temporário', type: 'boolean', defaultValue: false, description: 'Marca itens criados durante Run para removê-los ao voltar ao editor.', readOnly: true },
      { name: 'checkpoint_name', label: 'Nome do santuário', type: 'string', defaultValue: 'Santuário', description: 'Nome exibido quando o jogador ativa este checkpoint.' },
      { name: 'checkpoint_active', label: 'Santuário ativo', type: 'boolean', defaultValue: false, description: 'Indica se este é o último checkpoint ativado.', readOnly: true },
      { name: 'checkpoint_restore_resources', label: 'Restaurar recursos ao ativar', type: 'boolean', defaultValue: true, description: 'Recupera vida, éter e vigor quando o jogador ativa o santuário.' },
      { name: 'echoes_amount', label: 'Ecos recuperáveis', type: 'number', defaultValue: 0, description: 'Quantidade de Ecos deixada pelo jogador ao morrer.', min: 0, max: 999999999, step: 1, readOnly: true },
      { name: 'drop_item_id', label: 'ID do item derrubado', type: 'string', defaultValue: '', description: 'ID opcional do item que este inimigo pode derrubar quando morrer.' },
      { name: 'drop_chance', label: 'Chance de drop', type: 'number', defaultValue: 0.35, description: 'Probabilidade de drop de 0 a 1.', min: 0, max: 1, step: 0.05 },
      { name: 'drop_quantity', label: 'Quantidade derrubada', type: 'number', defaultValue: 1, description: 'Quantidade de itens no drop.', min: 1, max: 99, step: 1 },
    ],
    triggers: [
      { id: 'interact', label: 'Interação próxima', description: 'Um jogador interagiu com este objeto através do sistema genérico de proximidade.' },
      { id: 'loot_collected', label: 'Loot coletado', description: 'Um item deste objeto foi concedido pelo inventário genérico.' },
      { id: 'echo_cache_collected', label: 'Ecos recuperados', description: 'O jogador recuperou os Ecos deixados ao morrer.' },
      { id: 'combat_started', label: 'Combate iniciado', description: 'Um alvo hostil detectou o personagem ou recebeu o primeiro ataque.' },
      { id: 'quick_attack', label: 'Ataque rápido', description: 'O jogador solicita um ataque rápido com a arma equipada.' },
      { id: 'heavy_attack', label: 'Ataque pesado', description: 'O jogador solicita um ataque pesado ou carregado.' },
      { id: 'dodge', label: 'Esquiva', description: 'O jogador solicita uma esquiva usando vigor.' },
      { id: 'parry_success', label: 'Aparo perfeito', description: 'Um ataque inimigo foi aparado dentro da janela configurada.' },
      { id: 'spell_cast', label: 'Feitiço lançado', description: 'Um feitiço foi lançado e os custos foram validados.' },
      { id: 'sigil_triggered', label: 'Sigilo ativado', description: 'Um sigilo preparado detectou sua condição de ativação.' },
      { id: 'posture_broken', label: 'Postura quebrada', description: 'A postura de um combatente chegou ao limite.' },
      { id: 'enemy_killed', label: 'Inimigo derrotado', description: 'Um inimigo entrou no estado de morte.' },
      { id: 'enemy_spotted', label: 'Jogador detectado', description: 'A IA hostil detectou o jogador dentro do alcance de percepção.' },
      { id: 'enemy_attack', label: 'Ataque inimigo', description: 'A IA iniciou um ataque contra o jogador.' },
      { id: 'enemy_lost_target', label: 'Jogador perdido', description: 'O jogador saiu do alcance de percepção da IA.' },
      { id: 'level_up', label: 'Subiu de nível', description: 'A experiência acumulada ultrapassou o requisito e concedeu um ponto de atributo.' },
      { id: 'player_died', label: 'Jogador morreu', description: 'A vida chegou a zero e o estado de morte foi ativado.' },
      { id: 'checkpoint_used', label: 'Santuário usado', description: 'O jogador ativou um santuário ou ponto de descanso.' },
    ],
    conditions: [
      { id: 'has_vitality', label: 'Possui vida', description: 'Verifica se a vida atual é maior que zero.' },
      { id: 'has_ether', label: 'Éter suficiente', description: 'Verifica se o personagem pode pagar o custo de magia.' },
      { id: 'has_stamina', label: 'Vigor suficiente', description: 'Verifica se o personagem pode executar a ação física.' },
      { id: 'target_in_range', label: 'Alvo no alcance', description: 'Verifica distância e alcance de ataque ou feitiço.' },
      { id: 'target_vulnerable', label: 'Alvo vulnerável', description: 'Verifica atordoamento, recuperação ou fase vulnerável do alvo.' },
      { id: 'sigil_ready', label: 'Sigilo preparado', description: 'Verifica se o sigilo está equipado e fora de recarga.' },
      { id: 'is_alive', label: 'Está vivo', description: 'Impede ações de combate enquanto o personagem está morto.' },
    ],
    actions: [
      { id: 'apply_damage', label: 'Aplicar dano', description: 'Aplica dano físico, mágico ou elemental com resistências.' },
      { id: 'restore_vitality', label: 'Restaurar vida', description: 'Recupera vida sem ultrapassar o limite máximo.' },
      { id: 'spend_ether', label: 'Gastar éter', description: 'Deduz o custo de um feitiço ou sigilo se houver recurso suficiente.' },
      { id: 'spend_stamina', label: 'Gastar vigor', description: 'Deduz o custo de ataque, esquiva ou bloqueio.' },
      { id: 'cast_spell', label: 'Lançar feitiço', description: 'Solicita o feitiço equipado com alvo, alcance, custo e recarga.' },
      { id: 'activate_sigil', label: 'Ativar sigilo', description: 'Cria ou dispara um sigilo preparado.' },
      { id: 'add_status_effect', label: 'Aplicar efeito de estado', description: 'Aplica queimadura, sangramento, geada, choque, maldição ou lentidão.' },
      { id: 'add_echoes', label: 'Adicionar Ecos', description: 'Adiciona recurso de progressão por vitória ou recompensa.' },
      { id: 'respawn_at_checkpoint', label: 'Renascer no santuário', description: 'Reposiciona o jogador no último ponto de descanso salvo.' },
    ],
    globalScripts: [
      {
        id: 'item-use-request',
        name: 'Usar item selecionado',
        enabled: true,
        trigger: { type: 'global_event', eventId: 'veilborne:item_use_request' },
        conditions: [],
        actions: [{
          type: 'javascript',
          code: `const itemId = api.global.get('item_use_request');
api.global.set('item_use_request', '');
api.global.set('item_use_result', '');
api.global.set('item_use_visual_color', 0);
if (typeof itemId !== 'string' || !itemId.trim()) return;
const catalog = ${JSON.stringify(VEILBORNE_RUNTIME_ITEMS)};
const item = catalog[itemId];
if (!item || api.inventory.quantity(itemId, 'inventario_json') < 1) return;
const readNumber = (name, fallback) => {
  const value = api.global.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
if (api.global.get('morto') === true || api.global.get('jogador_morreu') === true || readNumber('vida', 100) <= 0) {
  api.notice('Não é possível usar itens enquanto o personagem está morto.', 1.8, 'loot_notice');
  api.global.set('item_use_result', 'blocked');
  return;
}
let consumed = false;
if (item.effect === 'restore_vitality') {
  const current = readNumber('vida', 100);
  const maximum = Math.max(1, readNumber('vida_max', 100));
  const next = Math.min(maximum, current + item.amount);
  consumed = next > current;
  if (consumed) api.global.set('vida', next);
} else if (item.effect === 'restore_ether') {
  const current = readNumber('eter', 100);
  const maximum = Math.max(1, readNumber('eter_max', 100));
  const next = Math.min(maximum, current + item.amount);
  consumed = next > current;
  if (consumed) api.global.set('eter', next);
} else if (item.effect === 'restore_stamina') {
  const current = readNumber('vigor', 100);
  const maximum = Math.max(1, readNumber('vigor_max', 100));
  const next = Math.min(maximum, current + item.amount);
  consumed = next > current;
  if (consumed) api.global.set('vigor', next);
} else if (item.effect === 'add_echoes') {
  api.global.set('ecos', Math.max(0, readNumber('ecos', 0)) + item.amount);
  consumed = true;
} else if (item.effect === 'area_damage') {
  const numberFromEvent = (name, fallback) => {
    const value = api.event.get(name);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const player = {
    x: numberFromEvent('avatarX', 0),
    y: numberFromEvent('avatarY', 0),
    z: numberFromEvent('avatarZ', 0),
  };
  const forward = {
    x: numberFromEvent('forwardX', 0),
    z: numberFromEvent('forwardZ', 1),
  };
  const hostiles = api.package.list('veilborne_rpg')
    .filter(candidate => candidate.enabled
      && candidate.variables.entity_role === 'combatant'
      && candidate.variables.faction === 'hostile'
      && candidate.variables.morto !== true)
    .map(candidate => ({ instance: candidate, position: api.world.position(candidate.ownerObjectId) }))
    .filter(candidate => candidate.position && candidate.position.visible)
    .map(candidate => ({
      ...candidate,
      distance: Math.hypot(candidate.position.x - player.x, candidate.position.z - player.z),
    }));
  const target = hostiles
    .filter(candidate => candidate.distance <= (item.range ?? 8) && candidate.distance > 0.001)
    .sort((a, b) => a.distance - b.distance)[0];
  const center = target
    ? { ...target.position }
    : {
        x: player.x + forward.x * Math.min(item.range ?? 4, 3.5),
        y: player.y + 0.6,
        z: player.z + forward.z * Math.min(item.range ?? 4, 3.5),
      };
  const radius = item.radius ?? 3;
  const resistanceVariables = {
    physical: 'res_fisica',
    fire: 'res_chama',
    frost: 'res_geada',
    storm: 'res_tempestade',
    blood: 'res_sangue',
    shadow: 'res_sombra',
    spirit: 'res_espirito',
    arcane: 'res_arcano',
  };
  for (const candidate of hostiles) {
    if (Math.hypot(candidate.position.x - center.x, candidate.position.z - center.z) > radius) continue;
    const owner = candidate.instance.ownerObjectId;
    const damageType = item.damageType ?? 'fire';
    const result = api.combat.damage(owner, {
      packageId: 'veilborne_rpg',
      amount: item.amount,
      damageType,
      healthVariable: 'vida',
      maximumHealthVariable: 'vida_max',
      resistanceVariable: resistanceVariables[damageType] ?? 'res_fisica',
      postureVariable: 'postura',
      maximumPostureVariable: 'postura_max',
      postureDamage: item.postureDamage ?? 10,
      deadVariable: 'morto',
      defeatedEvent: 'enemy_killed',
    });
    if (item.effect === 'area_damage' && !result.killed) {
      api.combat.applyStatus(owner, {
        id: 'burn',
        potency: 2,
        remainingSeconds: 3,
        stacks: 1,
        source: 'item:' + itemId,
        damageType,
      }, 'veilborne_rpg');
    }
    if (result.killed) {
      api.package.set(owner, 'veilborne_rpg', 'ai_state', 'dead');
      api.animation.playOnce(owner, 'death', true, true);
    }
  }
  consumed = true;
}
if (!consumed) {
  api.notice('Não é possível usar este item agora.', 1.8, 'loot_notice');
  api.global.set('item_use_result', 'blocked');
  return;
}
if (!api.inventory.consume(itemId, 1, 'inventario_json')) return;
api.global.set('item_use_visual_color', item.visualColor);
api.global.set('item_use_result', 'used');
api.notice('Usado: ' + item.name, 2, 'loot_notice');`,
        }],
      },
      {
        id: 'player-death',
        name: 'Registrar morte e criar cache de Ecos',
        enabled: true,
        trigger: { type: 'global_event', eventId: 'veilborne:player_died' },
        conditions: [],
        actions: [{
          type: 'javascript',
          code: `const number = (name, fallback) => {
  const value = api.global.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const eventNumber = (name, fallback) => {
  const value = api.event.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const death = {
  x: eventNumber('avatarX', 0),
  y: eventNumber('avatarY', 0),
  z: eventNumber('avatarZ', 0),
};
api.global.set('ponto_de_morte_x', death.x);
api.global.set('ponto_de_morte_y', death.y);
api.global.set('ponto_de_morte_z', death.z);
api.global.set('jogador_morreu', true);
api.global.set('morte_contagem', 2.2);
for (const cache of api.package.list('veilborne_rpg')) {
  if (cache.variables.entity_role === 'echo_cache') api.world.remove(cache.ownerObjectId);
}
const echoes = Math.max(0, Math.floor(number('ecos', 0)));
api.global.set('ecos_perdidos', echoes);
if (echoes > 0) {
  api.global.set('ecos', 0);
  const cacheId = api.world.spawnPrimitive({
    name: 'Ecos perdidos',
    shape: 'octahedron',
    x: death.x,
    y: death.y + 0.4,
    z: death.z,
    size: 0.3,
    color: 0xe9bf75,
    emissive: 0x9e682b,
    emissiveIntensity: 1.1,
    metalness: 0.35,
    roughness: 0.2,
    objectType: 'sphere',
  });
  api.package.install(cacheId, 'veilborne_rpg');
  api.package.configure(cacheId, 'veilborne_rpg', {
    entity_role: 'echo_cache',
    faction: 'neutral',
    echoes_amount: echoes,
    ai_enabled: false,
    drop_item_id: '',
    loot_spawned: true,
  });
  api.notice('Você morreu. Os Ecos foram deixados no local.', 2.4, 'loot_notice');
} else {
  api.notice('Você morreu. Retorno ao último santuário...', 2.4, 'loot_notice');
}`,
        }],
      },
      {
        id: 'restore-echo-cache',
        name: 'Reconstruir cache de Ecos salvo',
        enabled: true,
        trigger: { type: 'global_event', eventId: 'veilborne:restore_echo_cache' },
        conditions: [],
        actions: [{
          type: 'javascript',
          code: `const rawAmount = api.global.get('ecos_perdidos');
const amount = typeof rawAmount === 'number' && Number.isFinite(rawAmount)
  ? Math.max(0, Math.floor(rawAmount))
  : 0;
if (amount <= 0) return;
const existing = api.package.list('veilborne_rpg').find(instance =>
  instance.enabled
  && instance.variables.entity_role === 'echo_cache'
  && api.world.position(instance.ownerObjectId) !== null
);
if (existing) return;
const readNumber = (name, fallback) => {
  const value = api.global.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const cacheId = api.world.spawnPrimitive({
  name: 'Ecos perdidos',
  shape: 'octahedron',
  x: readNumber('ponto_de_morte_x', 0),
  y: readNumber('ponto_de_morte_y', 0) + 0.4,
  z: readNumber('ponto_de_morte_z', 0),
  size: 0.3,
  color: 0xe9bf75,
  emissive: 0x9e682b,
  emissiveIntensity: 1.1,
  metalness: 0.35,
  roughness: 0.2,
  objectType: 'sphere',
});
api.package.install(cacheId, 'veilborne_rpg');
api.package.configure(cacheId, 'veilborne_rpg', {
  entity_role: 'echo_cache',
  faction: 'neutral',
  echoes_amount: amount,
  ai_enabled: false,
  drop_item_id: '',
  loot_spawned: true,
});`,
        }],
      },
      {
        id: 'player-respawn',
        name: 'Calcular retorno ao santuário e restaurar recursos',
        enabled: true,
        trigger: { type: 'global_event', eventId: 'veilborne:respawn_requested' },
        conditions: [],
        actions: [{
          type: 'javascript',
          code: `const number = (name, fallback) => {
  const value = api.global.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const eventNumber = (name, fallback) => {
  const value = api.event.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const checkpointId = api.global.get('checkpoint_id');
let spawn = null;
if (typeof checkpointId === 'string' && checkpointId.trim()) {
  const checkpoint = api.world.position(checkpointId);
  const bounds = api.world.bounds(checkpointId);
  if (checkpoint && bounds) {
    spawn = { x: checkpoint.x, y: bounds.max.y + 0.05, z: checkpoint.z };
  } else {
    spawn = {
      x: number('checkpoint_x', eventNumber('defaultSpawnX', 0)),
      y: number('checkpoint_y', eventNumber('defaultSpawnY', 1)),
      z: number('checkpoint_z', eventNumber('defaultSpawnZ', 0)),
    };
  }
}
if (!spawn) {
  spawn = {
    x: eventNumber('defaultSpawnX', 0),
    y: eventNumber('defaultSpawnY', 1),
    z: eventNumber('defaultSpawnZ', 0),
  };
}
api.global.set('respawn_x', spawn.x);
api.global.set('respawn_y', spawn.y);
api.global.set('respawn_z', spawn.z);
api.global.set('vida', Math.max(1, number('vida_max', 100)));
api.global.set('eter', Math.max(1, number('eter_max', 100)));
api.global.set('vigor', Math.max(1, number('vigor_max', 100)));
api.global.set('postura', 0);
api.global.set('morto', false);
api.global.set('jogador_morreu', false);
api.global.set('jogador_atordoado', false);
api.global.set('morte_contagem', 0);
api.notice('Você retornou ao santuário.', 2.2, 'loot_notice');`,
        }],
      },
    ],
    scripts: [
      {
        id: 'boss-phase-scaling',
        name: 'Escalar ataque por fase do chefe',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'enemy_attack',
        },
        conditions: [
          { type: 'variable', name: 'ai_profile', operator: 'equals', value: 'boss_phases' },
        ],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const health = api.package.get(owner, 'veilborne_rpg', 'vida');
const maximum = api.package.get(owner, 'veilborne_rpg', 'vida_max');
const ratio = typeof health === 'number' && typeof maximum === 'number' && maximum > 0
  ? Math.max(0, health) / maximum
  : 1;
const phase = ratio <= 0.25 ? 3 : ratio <= 0.6 ? 2 : 1;
const multiplier = phase === 3 ? 1.45 : phase === 2 ? 1.2 : 1;
api.package.set(owner, 'veilborne_rpg', 'boss_phase', phase);
api.package.set(owner, 'veilborne_rpg', 'ai_damage_multiplier', multiplier);`,
        }],
      },
      {
        id: 'checkpoint-activate',
        name: 'Ativar santuário e salvar ponto de retorno',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'interact',
        },
        conditions: [
          { type: 'variable', name: 'entity_role', operator: 'equals', value: 'checkpoint' },
        ],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const position = api.world.position(owner);
const bounds = api.world.bounds(owner);
if (!position || !bounds) return;
api.global.set('checkpoint_id', owner);
api.global.set('checkpoint_x', position.x);
api.global.set('checkpoint_y', bounds.max.y + 0.05);
api.global.set('checkpoint_z', position.z);
for (const checkpoint of api.package.list('veilborne_rpg')) {
  if (checkpoint.variables.entity_role !== 'checkpoint') continue;
  api.package.set(checkpoint.ownerObjectId, 'veilborne_rpg', 'checkpoint_active', checkpoint.ownerObjectId === owner);
}
const restore = api.package.get(owner, 'veilborne_rpg', 'checkpoint_restore_resources') !== false;
api.global.set('checkpoint_restore_completed', restore);
if (restore) {
  const current = (name, fallback) => {
    const value = api.global.get(name);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  api.global.set('vida', current('vida_max', 100));
  api.global.set('eter', current('eter_max', 100));
  api.global.set('vigor', current('vigor_max', 100));
  api.global.set('postura', 0);
  api.global.set('morto', false);
  api.global.set('jogador_morreu', false);
  api.global.set('jogador_atordoado', false);
}
const rawName = api.package.get(owner, 'veilborne_rpg', 'checkpoint_name');
api.notice('Santuário ativado: ' + (typeof rawName === 'string' ? rawName : 'Santuário'), 2.4, 'loot_notice');
api.package.triggerEvent(owner, 'veilborne_rpg', 'checkpoint_used');`,
        }],
      },
      {
        id: 'echo-cache-pickup',
        name: 'Recuperar Ecos perdidos',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'interact',
        },
        conditions: [
          { type: 'variable', name: 'entity_role', operator: 'equals', value: 'echo_cache' },
        ],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const rawAmount = api.package.get(owner, 'veilborne_rpg', 'echoes_amount');
const fallback = api.global.get('ecos_perdidos');
const amount = typeof rawAmount === 'number' && Number.isFinite(rawAmount)
  ? Math.max(0, Math.floor(rawAmount))
  : typeof fallback === 'number' && Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 0;
if (amount <= 0) return;
const current = api.global.get('ecos');
api.global.set('ecos', Math.max(0, typeof current === 'number' && Number.isFinite(current) ? current : 0) + amount);
api.global.set('ecos_perdidos', 0);
api.notice('Ecos recuperados: ' + amount, 2.6, 'loot_notice');
api.package.triggerEvent(owner, 'veilborne_rpg', 'echo_cache_collected');
api.world.remove(owner);`,
        }],
      },
      {
        id: 'loot-pickup',
        name: 'Conceder item ao interagir',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'interact',
        },
        conditions: [
          { type: 'variable', name: 'entity_role', operator: 'equals', value: 'loot' },
        ],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const itemId = api.package.get(owner, 'veilborne_rpg', 'loot_item_id');
const validItemIds = ${JSON.stringify(VEILBORNE_ITEM_IDS)};
if (typeof itemId !== 'string' || !validItemIds.includes(itemId)) return;
const rawQuantity = api.package.get(owner, 'veilborne_rpg', 'loot_quantity');
const quantity = typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) ? Math.max(1, Math.min(99, Math.floor(rawQuantity))) : 1;
const visible = api.world.position(owner)?.visible ?? true;
if (!api.inventory.grant(itemId, quantity, 'inventario_json')) {
  api.notice('Não foi possível adicionar o item.', 1.8, 'loot_notice');
  return;
}
api.package.set(owner, 'veilborne_rpg', 'loot_original_visible', visible);
api.package.set(owner, 'veilborne_rpg', 'loot_collected', true);
api.setVisible(owner, false);
api.notice('Item coletado ×' + quantity, 2.4, 'loot_notice');
api.package.triggerEvent(owner, 'veilborne_rpg', 'loot_collected');`,
        }],
      },
      {
        id: 'enemy-drop-item',
        name: 'Criar drop a partir do catálogo de itens',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'enemy_killed',
        },
        conditions: [
          { type: 'variable', name: 'drop_item_id', operator: 'not_equals', value: '' },
        ],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const itemId = api.package.get(owner, 'veilborne_rpg', 'drop_item_id');
const catalog = ${JSON.stringify(VEILBORNE_RUNTIME_ITEMS)};
if (typeof itemId !== 'string' || !Object.prototype.hasOwnProperty.call(catalog, itemId)) return;
const rawChance = api.package.get(owner, 'veilborne_rpg', 'drop_chance');
const chance = typeof rawChance === 'number' && Number.isFinite(rawChance) ? Math.max(0, Math.min(1, rawChance)) : 0.35;
if (chance <= 0 || Math.random() > chance) return;
const rawQuantity = api.package.get(owner, 'veilborne_rpg', 'drop_quantity');
const quantity = typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) ? Math.max(1, Math.min(99, Math.floor(rawQuantity))) : 1;
const source = api.world.position(owner);
if (!source) return;
const item = catalog[itemId];
const dropId = api.world.spawnPrimitive({
  name: item.name,
  shape: 'octahedron',
  x: source.x,
  y: api.world.groundHeightAt(source.x, source.z) + 0.3,
  z: source.z,
  size: 0.24,
  color: item.visualColor,
  emissive: item.visualColor,
  emissiveIntensity: 0.6,
  metalness: 0.15,
  roughness: 0.32,
});
api.package.install(dropId, 'veilborne_rpg');
api.package.configure(dropId, 'veilborne_rpg', {
  entity_role: 'loot',
  faction: 'neutral',
  loot_item_id: itemId,
  loot_quantity: quantity,
  loot_collected: false,
  loot_original_visible: true,
  loot_spawned: true,
  ai_enabled: false,
  drop_item_id: '',
});`,
        }],
      },
      {
        id: 'enemy-killed-reward',
        name: 'Recompensa por inimigo derrotado',
        enabled: true,
        trigger: {
          type: 'package_event',
          objectId: '{ID_OBJECT}',
          packageId: 'veilborne_rpg',
          eventId: 'enemy_killed',
        },
        conditions: [],
        actions: [{
          type: 'javascript',
          code: `const owner = '{ID_OBJECT}';
const getNumber = (name, fallback) => {
  const value = api.global.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const profileValue = api.package.get(owner, 'veilborne_rpg', 'ai_profile');
const profile = typeof profileValue === 'string' ? profileValue.toLowerCase() : 'melee';
const rewards = {
  melee: { echoes: 10, experience: 15 },
  ranged_caster: { echoes: 12, experience: 18 },
  flanker: { echoes: 14, experience: 20 },
  guard_breaker: { echoes: 22, experience: 40 },
  boss_phases: { echoes: 100, experience: 150 },
};
const base = rewards[profile] || rewards.melee;
const readReward = (name, fallback) => {
  const value = api.package.get(owner, 'veilborne_rpg', name);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};
const echoes = readReward('eco_reward', base.echoes);
const rewardExperience = readReward('xp_reward', base.experience);
if (echoes > 0) api.global.set('ecos', Math.max(0, getNumber('ecos', 0)) + echoes);

let level = Math.max(1, Math.floor(getNumber('nivel', 1)));
let experience = Math.max(0, getNumber('experiencia', 0)) + rewardExperience;
let attributePoints = Math.max(0, Math.floor(getNumber('pontos_atributo', 0)));
const thresholdForLevel = currentLevel => Math.max(100, Math.floor(100 * Math.pow(currentLevel, 1.22)));
let threshold = thresholdForLevel(level);
let levelsGained = 0;
while (experience >= threshold && level < 999) {
  experience -= threshold;
  level += 1;
  levelsGained += 1;
  attributePoints += 1;
  threshold = thresholdForLevel(level);
}
api.global.set('nivel', level);
api.global.set('experiencia', experience);
api.global.set('experiencia_proximo_nivel', threshold);
api.global.set('pontos_atributo', attributePoints);
if (levelsGained > 0) api.package.triggerEvent(owner, 'veilborne_rpg', 'level_up');`,
        }],
      },
    ],
    defaultConfig: {
      aiProfiles: {
        melee: { ...VEILBORNE_AI_PROFILES.melee },
        ranged_caster: { ...VEILBORNE_AI_PROFILES.ranged_caster },
        flanker: { ...VEILBORNE_AI_PROFILES.flanker },
        guard_breaker: { ...VEILBORNE_AI_PROFILES.guard_breaker },
        boss_phases: { ...VEILBORNE_AI_PROFILES.boss_phases },
      },
      combat: {
        targetLock: true,
        quickAttack: true,
        heavyAttack: true,
        chargedAttack: true,
        dodgeInvulnerabilitySeconds: 0.22,
        dodgeVigorCost: 22,
        parryWindowSeconds: 0.2,
        postureBreakEnabled: true,
      },
      equippedWeapon: 'starter_arcane_sword',
      equippedCatalyst: 'starter_rune_staff',
      preparedSigils: ['ward', 'blast', 'hunter_mark', 'slow_field'],
      spellSlots: 4,
      sigilSlots: 4,
      deathRecovery: 'recover_echoes_at_death_location',
      saveProgression: true,
    },
  }

/** Registra a definição apenas no host que escolher carregar este pacote de jogo. */
export function registerVeilborneBehaviorPackage(): () => void {
  return registerBehaviorPackageDefinition(VEILBORNE_BEHAVIOR_PACKAGE_DEFINITION)
}
