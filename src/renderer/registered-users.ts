import type {
  HakkeiPreloadApi,
  RegisteredSessionEntry,
  RegisteredUsersPayload,
} from "../shared/types.ts";

const api = (window as unknown as { hakkei: HakkeiPreloadApi }).hakkei;
const root = document.getElementById("registered-users-app");

type ViewState = {
  loading: boolean;
  statusText: string;
  statusTone: "idle" | "ok" | "error";
  payload: RegisteredUsersPayload | null;
};

type LatestUser = RegisteredSessionEntry & {
  registrationCount: number;
};

const state: ViewState = {
  loading: false,
  statusText: "読み込み前",
  statusTone: "idle",
  payload: null,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function latestUsers(entries: RegisteredSessionEntry[]): LatestUser[] {
  const byPlayer = new Map<string, LatestUser>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.playerId, (counts.get(entry.playerId) ?? 0) + 1);
    const previous = byPlayer.get(entry.playerId);
    if (!previous || entry.registeredAtMs > previous.registeredAtMs) {
      byPlayer.set(entry.playerId, { ...entry, registrationCount: counts.get(entry.playerId) ?? 1 });
    }
  }
  for (const user of byPlayer.values()) {
    user.registrationCount = counts.get(user.playerId) ?? user.registrationCount;
  }
  return [...byPlayer.values()].sort((a, b) =>
    a.playerName.localeCompare(b.playerName) || b.registeredAtMs - a.registeredAtMs,
  );
}

function renderRows(entries: RegisteredSessionEntry[]): string {
  if (entries.length === 0) {
    return `<tr><td colspan="4" class="empty">登録はまだありません</td></tr>`;
  }
  return entries
    .map(
      (entry) => `
        <tr>
          <td class="name">${escapeHtml(entry.playerName)}</td>
          <td><code>${escapeHtml(entry.sessionId)}</code></td>
          <td><code>${escapeHtml(entry.playerId)}</code></td>
          <td>${escapeHtml(formatDate(entry.registeredAtMs))}</td>
        </tr>
      `,
    )
    .join("");
}

function renderLatestRows(users: LatestUser[]): string {
  if (users.length === 0) {
    return `<tr><td colspan="5" class="empty">登録はまだありません</td></tr>`;
  }
  return users
    .map(
      (user) => `
        <tr>
          <td class="name">${escapeHtml(user.playerName)}</td>
          <td>${user.registrationCount}</td>
          <td><code>${escapeHtml(user.playerId)}</code></td>
          <td><code>${escapeHtml(user.sessionId)}</code></td>
          <td>${escapeHtml(formatDate(user.registeredAtMs))}</td>
        </tr>
      `,
    )
    .join("");
}

function render(): void {
  if (!root) {
    return;
  }
  const entries = state.payload?.entries ?? [];
  const recentEntries = [...entries].sort((a, b) => b.registeredAtMs - a.registeredAtMs).slice(0, 50);
  const users = latestUsers(entries);
  const generatedAt = state.payload ? formatDate(state.payload.generatedAtMs) : "-";
  root.innerHTML = `
    <main class="users-shell">
      <header class="users-header">
        <div>
          <p class="eyebrow">Hakkei Score Server</p>
          <h1>登録ユーザー一覧</h1>
        </div>
        <div class="users-actions">
          <button id="refresh-users" class="primary" type="button" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "読み込み中" : "更新"}
          </button>
        </div>
      </header>

      <div class="users-status ${state.statusTone}">
        ${escapeHtml(state.statusText)}
      </div>

      <section class="summary-grid" aria-label="summary">
        <div class="summary-card">
          <span>ユーザー数</span>
          <strong>${users.length}</strong>
        </div>
        <div class="summary-card">
          <span>session登録数</span>
          <strong>${entries.length}</strong>
        </div>
        <div class="summary-card wide">
          <span>取得時刻</span>
          <strong>${escapeHtml(generatedAt)}</strong>
        </div>
      </section>

      <section class="users-panel">
        <div class="panel-heading">
          <h2>最新ユーザー</h2>
          <p>同じスマホlicenseはplayerIdでまとめ、最後に使われた名前とsessionを表示します。</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>回数</th>
                <th>Player ID</th>
                <th>Last Session</th>
                <th>最終登録</th>
              </tr>
            </thead>
            <tbody>${renderLatestRows(users)}</tbody>
          </table>
        </div>
      </section>

      <section class="users-panel">
        <div class="panel-heading">
          <h2>直近session登録</h2>
          <p>古いQRで登録されたものもここに残ります。ゲーム進行に使われるのは現在表示中QRのsessionだけです。</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>Session ID</th>
                <th>Player ID</th>
                <th>登録時刻</th>
              </tr>
            </thead>
            <tbody>${renderRows(recentEntries)}</tbody>
          </table>
        </div>
      </section>
    </main>
  `;

  document.getElementById("refresh-users")?.addEventListener("click", () => {
    void loadRegisteredUsers();
  });
}

async function loadRegisteredUsers(): Promise<void> {
  state.loading = true;
  state.statusText = "登録サーバーから読み込み中...";
  state.statusTone = "idle";
  render();
  const result = await api.registeredUsersList();
  state.loading = false;
  if (result.ok) {
    state.payload = result.value;
    state.statusText = "読み込み完了";
    state.statusTone = "ok";
  } else {
    state.statusText = result.messageJa;
    state.statusTone = "error";
  }
  render();
}

render();
void loadRegisteredUsers();
