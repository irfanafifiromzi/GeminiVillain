<script setup lang="ts">
import { useProjects, type Project } from '@/stores/projects'
import { useServers, type Server } from '@/stores/servers'

const projects = useProjects()
const servers = useServers()

defineEmits<{
  (e: 'add-project'): void
  (e: 'edit-project', project: Project): void
  (e: 'select-project', project: Project): void
  (e: 'add-server'): void
  (e: 'edit-server', server: Server): void
  (e: 'select-server', server: Server): void
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="section-head">
      <span class="pixel">Projects</span>
      <button class="icon" title="Register a project" @click="$emit('add-project')">+</button>
    </div>

    <div class="list">
      <p v-if="!projects.state.projects.length" class="empty">
        No projects yet. Register one to launch its terminal and commands from here.
      </p>

      <button
        v-for="project in projects.state.projects"
        :key="project.id"
        class="row"
        :class="{
          on: project.id === projects.state.selectedId,
          gone: projects.isMissing(project.path),
        }"
        :title="project.path"
        @click="$emit('select-project', project)"
        @dblclick="$emit('edit-project', project)"
      >
        <span class="body">
          <span class="name">{{ project.name }}</span>
          <span class="sub">
            {{ project.path
            }}<template v-if="projects.isMissing(project.path)"> — not found</template>
          </span>
        </span>
      </button>
    </div>

    <div class="section-head">
      <span class="pixel">Servers</span>
      <button class="icon" title="Add a server" @click="$emit('add-server')">+</button>
    </div>

    <div class="list servers">
      <p v-if="!servers.state.servers.length" class="empty">
        No servers yet. Add one to open an SSH session in a tab.
      </p>

      <button
        v-for="server in servers.state.servers"
        :key="server.id"
        class="row"
        :class="{ on: server.id === servers.state.selectedId }"
        :title="`${server.user ? server.user + '@' : ''}${server.host}`"
        @click="$emit('select-server', server)"
        @dblclick="$emit('edit-server', server)"
      >
        <span class="body">
          <span class="name">
            {{ server.name }}<span v-if="server.production" class="prod">prod</span>
          </span>
          <span class="sub">{{ server.user ? server.user + '@' : '' }}{{ server.host }}</span>
        </span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 238px;
  flex: none;
  background: var(--surface-1);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 8px 8px 12px;
  flex: none;
}

.section-head span {
  font-size: 8px;
  line-height: 1.6;
  color: var(--fg-faint);
  text-transform: uppercase;
}

.icon {
  width: 22px;
  height: 22px;
  border: 0;
  background: transparent;
  color: var(--fg-faint);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s var(--ease-out);
}

.icon:hover { color: var(--accent); }

.list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px;
}

/* Servers get the smaller share until there are many of them. */
.servers { flex: 0 1 auto; max-height: 45%; padding-bottom: 10px; }

/* The fill marks the selection on its own — no accent bar, no icon. */
.row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 6px 10px 7px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-dim);
  font-family: var(--mono);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.row:hover { background: var(--surface-2); }

.row.on {
  background: var(--accent-soft);
  color: var(--fg);
}

.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.name {
  font-size: 12px;
  line-height: 17px;
  color: var(--fg-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.on .name { color: var(--accent); }
.row.on .sub { color: var(--fg-dim); }
.row.gone .sub { color: var(--danger-fg); }

.prod {
  margin-left: 7px;
  font-size: 9.5px;
  color: var(--danger-fg);
  letter-spacing: 0.06em;
}

.sub {
  font-size: 10px;
  line-height: 14px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 2px 12px 10px;
  font-size: 11px;
  line-height: 1.65;
  color: var(--fg-faint);
}
</style>
