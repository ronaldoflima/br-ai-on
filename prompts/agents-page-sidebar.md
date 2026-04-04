# Prompt: Refatorar página de Agentes — sidebar de filtros

## Contexto do projeto

Projeto: `/home/mcpgw/br-ai-on`
Dashboard: `/home/mcpgw/br-ai-on/dashboard/` (Next.js 15, React 19, CSS Modules)

Padrão visual:
- Variáveis CSS em `dashboard/app/globals.css` (--bg-*, --text-*, --border, --accent, --success, --warning)
- CSS Modules ao lado dos componentes
- Classes utilitárias globais: `.card`, `.btn`, `.btn-primary`, `.badge`, `.badge-muted`, `.badge-success`, `.grid`, `.grid-2`, `.page-header`, `.page-title`, `.form-group`, `.form-label`, `.input`
- Sem bibliotecas de UI externas (sem shadcn, radix, etc.)

Padrão de layout com sidebar lateral: ver `dashboard/app/terminal/page.tsx` e `dashboard/app/terminal/terminal.module.css` — usa `.desktopLayout` com `.sessionsList` (220px) + `.mainPanel` (flex: 1).

Padrão de sidebar de filtros já implementado: ver `dashboard/app/handoffs/page.tsx` e `dashboard/app/handoffs/handoffs.module.css`.

---

## Arquivo a modificar

`dashboard/app/agents/page.tsx`

Estado atual:
- Filtros como botões no `page-header` (all / alive / handoff-only)
- Botão "Novo Agente" no `page-header`
- Form de criação inline (card expandido abaixo do header)
- Grid `.grid-2` de cards de agentes

Tipo disponível: `AgentSummary` (de `../lib/types`) com campos:
```ts
name: string
display_name: string
domain: string
version: string
schedule_interval: string
schedule_mode: "alive" | "handoff-only" | "disabled"
model: string
soul_preview: string
```

---

## O que implementar

### 1. Criar `dashboard/app/agents/agents.module.css`

Layout com sidebar esquerda de 220px e painel principal, seguindo o mesmo padrão de `handoffs.module.css`:

```css
.wrapper { ... }         /* flex-direction: column */
.desktopLayout { ... }   /* display: flex, gap: 16px */
.filterSidebar { ... }   /* width: 220px, overflow-y: auto */
.mainPanel { ... }       /* flex: 1, min-width: 0 */
.sidebarSection { ... }  /* margin-bottom: 12px */
.sidebarLabel { ... }    /* font-size: 11px, text-transform: uppercase, color: var(--text-muted) */
.checkRow { ... }        /* display: flex, align-items: center, gap: 6px, cursor: pointer */
.searchInput { ... }     /* width: 100%, padding: 6px 8px, font-size: 12px */
```

Mobile: `.desktopLayout` vira `flex-direction: column` abaixo de 768px.

### 2. Refatorar `dashboard/app/agents/page.tsx`

**Remover** dos botões de filtro do `page-header` (os badges all/alive/handoff-only).

**Manter** no `page-header`: título "Agentes" à esquerda + botão "Novo Agente" à direita.

**Adicionar** sidebar esquerda com:

#### Seção: Busca
- Input de texto, placeholder "Buscar agente..."
- Filtra por `name` e `display_name` (case-insensitive)

#### Seção: Schedule Mode
- Checkboxes: `alive`, `handoff-only`, `disabled`
- Por padrão todos marcados (= mostrar todos)
- Ao desmarcar um, esconde agentes com aquele mode

#### Seção: Domínio
- Extrair domínios únicos dos agentes carregados (ignorar strings vazias)
- Renderizar um checkbox por domínio
- Por padrão todos marcados

#### Seção: Modelo
- Extrair modelos únicos dos agentes carregados
- Checkbox por modelo, todos marcados por padrão

**Lógica de filtro**: client-side sobre o array `agents` já carregado. Aplicar todos os filtros em cadeia (AND).

**Form de criação**: manter o comportamento atual (card inline abaixo do header no mainPanel), mas mover o botão "Novo Agente" para o topo do mainPanel (header row com título vazio e o botão).

Dica: usar `useIsMobile()` hook local (igual ao de terminal/page.tsx) para colapsar a sidebar em mobile.

---

## Restrições

- Não adicionar dependências npm
- Não usar bibliotecas de UI externas
- Preservar o link para `/agents/[name]` em cada card
- Preservar o comportamento do form de criação (POST /api/agents)
- Seguir rigorosamente o padrão CSS do projeto (sem inline styles além do estritamente necessário)

---

## Para começar

1. Leia `dashboard/app/agents/page.tsx` (atual)
2. Leia `dashboard/app/handoffs/page.tsx` e `handoffs.module.css` (referência de sidebar de filtros)
3. Leia `dashboard/app/terminal/terminal.module.css` (referência de layout)
4. Implemente `agents.module.css` primeiro, depois refatore `page.tsx`
