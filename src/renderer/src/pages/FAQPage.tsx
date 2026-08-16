import type { ReactNode } from "react"
import type { Page } from "../constants"
import type { Lang } from "../i18n"

// Jumps to another entry and opens it — the FAQ is a list of collapsed
// <details>, so a plain #anchor would scroll to something still closed.
function FaqLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <button
      onClick={() => {
        const el = document.getElementById(to)
        if (!el) return
        el.setAttribute("open", "")
        el.scrollIntoView({ behavior: "smooth", block: "start" })
      }}
      className="text-sky-400 underline underline-offset-2 hover:text-sky-300 transition-colors">
      {children}
    </button>
  )
}

interface FaqItem {
  id: string
  q: string
  a: ReactNode
}

function faqContent(lang: Lang): FaqItem[] {
  const en: FaqItem[] = [
    {
      id: "start",
      q: "Getting started — step by step (start here)",
      a: (
        <>
          <p className="mb-3">Four steps, about 15 minutes. You don't need to know anything about AI.</p>

          <p className="text-foreground font-medium mb-1">1. Give the app a "brain"</p>
          <p className="mb-2">
            The app doesn't think on its own — it uses AI services online. You need a free key (a long
            password you copy from their website) from at least one of them. No credit card needed. Open
            {" "}<strong className="text-foreground">⚙ Providers</strong> (the gear icon, top right) → tab{" "}
            <strong className="text-foreground">FREE</strong>. Each provider has a link to create an account and
            get a key. Copy the text, paste it into the app, and click Save. See{" "}
            <FaqLink to="keys">where to get free keys</FaqLink>.
          </p>
          <p className="mb-3 text-muted-foreground text-xs">
            Do two or three, not just one. If one service is busy, the app switches to the next by itself.
          </p>

          <p className="text-foreground font-medium mb-1">2. Talk to it</p>
          <p className="mb-3">
            Go back to the chat and write normally, like you'd message a colleague. Pick a model in the
            selector at the top if you want — see{" "}
            <FaqLink to="modes">Smartest / Fastest / Manual</FaqLink>.
          </p>

          <p className="text-foreground font-medium mb-1">3. Switch to BUILD when you want it to actually do things</p>
          <p className="mb-3">
            By default the app is in <strong className="text-foreground">PLAN</strong> mode: it only talks. To let it
            create files, read your documents or run commands, switch to <strong className="text-foreground">BUILD</strong>
            {" "}— the button next to the model selector. See <FaqLink to="planbuild">PLAN vs BUILD</FaqLink>.
          </p>

          <p className="text-foreground font-medium mb-1">4. Connect your programs and accounts (optional)</p>
          <p className="mb-3">
            AutoCAD, Photoshop, Google Drive, Gmail, GitHub, WordPress and others. Open{" "}
            <strong className="text-foreground">⚙ Providers</strong> → tab <strong className="text-foreground">CONNECTORS</strong>.
            See <FaqLink to="connectors">how to connect each one</FaqLink>.
          </p>

          <p className="text-muted-foreground text-xs">
            Lost in the interface? <FaqLink to="menu">What every button does</FaqLink>.
          </p>
        </>
      ),
    },
    {
      id: "menu",
      q: "What does every button and area of the screen do?",
      a: (
        <>
          <p className="text-foreground font-medium mb-1 mt-1">Top right (the icon row)</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">📊 Analytics</strong> — how much you've used, which models, and the cost.</li>
            <li><strong className="text-foreground">🔧 My Skills</strong> — recipes you teach the app once and reuse. See <FaqLink to="skills">Skills</FaqLink>.</li>
            <li><strong className="text-foreground">🧠 Memories</strong> — facts about you it remembers in every conversation. See <FaqLink to="memories">Memories</FaqLink>.</li>
            <li><strong className="text-foreground">⬇ Export</strong> — saves the current conversation as Markdown or JSON. Only appears once there are messages.</li>
            <li><strong className="text-foreground">⚙ Providers</strong> — API keys and connectors. Four tabs: FREE, PAID, LOCAL and CONNECTORS.</li>
            <li><strong className="text-foreground">❓ FAQ</strong> — this page.</li>
            <li><strong className="text-foreground">☀ / 🌙</strong> — light or dark theme.</li>
            <li><strong className="text-foreground">PT / EN</strong> — interface language.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">Left sidebar</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Projects</strong> — group conversations by subject. Each project can have its own instructions and its own working folder. See <FaqLink to="projects">Projects</FaqLink>.</li>
            <li><strong className="text-foreground">Conversations</strong> — your history. Rename or delete from the ⋮ menu on each one.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">Above the chat</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Model selector</strong> — which AI answers you.</li>
            <li><strong className="text-foreground">Smartest / Fastest / Manual</strong> — which one it tries first. See <FaqLink to="modes">here</FaqLink>.</li>
            <li><strong className="text-foreground">PLAN / BUILD</strong> — whether it can touch your computer. See <FaqLink to="planbuild">here</FaqLink>.</li>
            <li><strong className="text-foreground">System instructions</strong> — rules for the whole conversation. See <FaqLink to="system">here</FaqLink>.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">Around the message box</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">📎</strong> — attach files (PDF, Word, Excel, images, code).</li>
            <li><strong className="text-foreground">⭐</strong> — texts you save to reuse. See <FaqLink to="prompts">here</FaqLink>.</li>
            <li><strong className="text-foreground">→</strong> — send. While it's answering this becomes a stop button.</li>
            <li>Hover your own message to <strong className="text-foreground">edit and resend</strong> it, or an answer to <strong className="text-foreground">regenerate</strong> it.</li>
          </ul>
        </>
      ),
    },
    {
      id: "models",
      q: "Why don't I see any models in the selector?",
      a: "You need to configure at least one API key first. Go to ⚙ Providers, pick a provider (e.g. Groq — free), add your API key, and click Save. The models will then appear in the list.",
    },
    {
      id: "keys",
      q: "Where do I get free API keys?",
      a: (
        <>
          Each provider has a "Get API Key" link next to its name. Here are the easiest free ones:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Groq:</strong> console.groq.com — fastest free LLM</li>
            <li><strong className="text-foreground">Gemini:</strong> aistudio.google.com — Google's free tier</li>
            <li><strong className="text-foreground">Cerebras:</strong> cloud.cerebras.ai — very fast, free tier</li>
            <li><strong className="text-foreground">OpenRouter:</strong> openrouter.ai — many models in one place</li>
            <li><strong className="text-foreground">Mistral:</strong> console.mistral.ai — European, free experimental plan</li>
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">Some only show the key once — copy it straight away.</p>
        </>
      ),
    },
    {
      id: "planbuild",
      q: "What's the difference between PLAN and BUILD?",
      a: (
        <>
          <p className="mb-2">It's the button next to the model selector, and it decides what the assistant is allowed to do.</p>
          <ul className="list-disc list-inside mb-2 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">PLAN</strong> (default) — conversation only. It answers, explains and plans, but never touches your files or your accounts.</li>
            <li><strong className="text-foreground">BUILD</strong> — it can read and write files, run commands, create Excel/Word/PowerPoint documents, and use your connectors (Drive, AutoCAD, GitHub...).</li>
          </ul>
          <p className="text-muted-foreground text-xs">If you ask it to create a file and nothing happens, you're almost certainly in PLAN.</p>
        </>
      ),
    },
    {
      id: "connectors",
      q: "How do I connect AutoCAD, Photoshop, Google Drive, GitHub and the rest?",
      a: (
        <>
          <p className="mb-2">⚙ Providers → <strong className="text-foreground">CONNECTORS</strong> tab. Everything uses your own accounts — nothing is shared with anyone else. Remember to be in <FaqLink to="planbuild">BUILD</FaqLink> mode to actually use them.</p>
          <p className="text-foreground font-medium mb-1">One click, nothing to install</p>
          <ul className="list-disc list-inside mb-3 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">AutoCAD</strong> (Windows only) — open AutoCAD first, then click Connect. The first time takes 1–3 minutes while the app downloads what it needs.</li>
            <li><strong className="text-foreground">Photoshop / Premiere Pro</strong> — needs Creative Cloud Desktop installed. At the end the plugin installer opens; inside the app, click Connect in the plugin panel.</li>
          </ul>
          <p className="text-foreground font-medium mb-1">Sign in with your account</p>
          <ul className="list-disc list-inside mb-3 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">Google Drive / Gmail</strong> — click Connect, sign in with Google, approve. It can then read your files or your email, and send messages on your behalf.</li>
            <li><strong className="text-foreground">Canva</strong> — same idea, sign in with Canva.</li>
          </ul>
          <p className="text-foreground font-medium mb-1">Paste a key or password</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">GitHub</strong> — a Personal Access Token (there's a link that pre-fills the right permissions).</li>
            <li><strong className="text-foreground">WordPress</strong> — your site URL, username and an Application Password from your own WordPress profile.</li>
            <li><strong className="text-foreground">n8n</strong> — your instance URL and an API key (Settings → n8n API).</li>
            <li><strong className="text-foreground">Magnific</strong> — your Freepik/Magnific API key, for upscaling and generating images.</li>
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">If a card shows a red box, the connector's server failed to start — the message tells you why.</p>
        </>
      ),
    },
    {
      id: "modes",
      q: "What do Smartest, Fastest and Manual mean?",
      a: (
        <>
          These decide which model the app tries first, when more than one is available:
          <ul className="list-disc list-inside mt-2 space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Smartest</strong> — tries the most capable model first. Good for hard questions, reasoning and code.</li>
            <li><strong className="text-foreground">Fastest</strong> — tries the model that replies quickest. Good for quick answers.</li>
            <li><strong className="text-foreground">Manual</strong> — uses the models in the order they're listed, without changing it.</li>
          </ul>
          <p className="mt-2">In all three, if the first model doesn't work, the app automatically tries the next one.</p>
        </>
      ),
    },
    {
      id: "projects",
      q: "What are Projects for?",
      a: (
        <>
          <p className="mb-2">In the left sidebar you can group conversations into projects — one per client, per job, per subject.</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Each project has its own <strong className="text-foreground">instructions</strong>, applied to every conversation inside it.</li>
            <li>Each project can have a <strong className="text-foreground">working folder</strong>: in BUILD mode, files are read and written there by default.</li>
          </ul>
        </>
      ),
    },
    {
      id: "system",
      q: "What are System Instructions?",
      a: (
        <>
          <p className="mb-2">The system instructions bar (just above the chat) lets you define how the model should behave for the <strong className="text-foreground">entire conversation</strong> — without repeating yourself in every message.</p>
          <p className="mb-2"><strong className="text-foreground">The big advantage:</strong> instead of writing "respond concisely, in bullet points, using Python for code examples" in every single message, you write it once at the top and the model follows it automatically.</p>
          <p className="mb-1 text-foreground">Real use cases:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li>Code conversation → <em>"Act as a senior engineer. Always show clean, commented code."</em></li>
            <li>Writing conversation → <em>"Write in a persuasive tone, short sentences, no long introductions."</em></li>
            <li>Learning conversation → <em>"Explain everything as if I'm a beginner, using simple analogies."</em></li>
            <li>Translation → <em>"Translate everything I write into formal English."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Saves automatically as you type. Each conversation has its own instructions.</p>
        </>
      ),
    },
    {
      id: "skills",
      q: "What are Skills (🔧)?",
      a: (
        <>
          <p className="mb-2">A skill is a recipe you write once and the assistant follows whenever it's relevant — your way of doing a recurring task.</p>
          <p className="mb-1 text-foreground">For example:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li><em>"When I ask for a report, always use this structure and this cover."</em></li>
            <li><em>"When I ask for a drawing, always work in millimetres and on layer 0."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Create and edit them on the 🔧 My Skills page.</p>
        </>
      ),
    },
    {
      id: "prompts",
      q: "What is the Prompt Library (⭐)?",
      a: (
        <>
          The ⭐ button next to the message box saves texts you use often, so you don't have to retype them.
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Click <strong className="text-foreground">⭐</strong> to open the list</li>
            <li>Click <strong className="text-foreground">"Save current"</strong> to save what you've written</li>
            <li>Click a saved text to fill the message box with it</li>
            <li>Hover over one and click <strong className="text-foreground">×</strong> to delete it</li>
          </ul>
          <p className="mt-2">Everything here stays on your computer, even after you close the app.</p>
        </>
      ),
    },
    {
      id: "memories",
      q: "What are Memories (🧠)?",
      a: (
        <>
          <p className="mb-2">The 🧠 Memories page lets you store personal facts the assistant will use in <strong className="text-foreground">every conversation</strong>.</p>
          <p className="mb-1 text-foreground">Examples of useful memories:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li><em>"I'm an architect and I work in AutoCAD every day."</em></li>
            <li><em>"I prefer concise answers with examples."</em></li>
            <li><em>"Always respond in Portuguese."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Add facts with the 🧠 button in the header. They're stored on your computer and used in every chat.</p>
        </>
      ),
    },
    {
      id: "artifacts",
      q: "What are Artifacts (▶ Preview)?",
      a: (
        <>
          When the model generates HTML or SVG code, a <strong className="text-foreground">▶ Preview</strong> button appears in the code block. Click it to open a live preview panel on the right side of the screen.
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>HTML pages, components and charts appear right away</li>
            <li>SVG graphics display with correct proportions</li>
            <li>Use <strong className="text-foreground">Open in new window</strong> to see the full result</li>
          </ul>
        </>
      ),
    },
  ]

  const pt: FaqItem[] = [
    {
      id: "start",
      q: "Como começar — passo a passo (começa por aqui)",
      a: (
        <>
          <p className="mb-3">São quatro passos e cerca de 15 minutos. Não precisas de perceber nada de IA.</p>

          <p className="text-foreground font-medium mb-1">1. Dar-lhe um "cérebro"</p>
          <p className="mb-2">
            A aplicação não pensa sozinha: usa serviços de IA na internet. Precisas de uma chave gratuita
            (uma senha comprida que copias do site do serviço) de pelo menos um deles. Nenhum pede cartão de
            crédito. Vai a <strong className="text-foreground">⚙ Providers</strong> (o ícone da roda dentada, em
            cima à direita) → separador <strong className="text-foreground">FREE</strong>. Cada serviço tem um link
            para criares conta e gerares a chave. Copia o texto, cola-o na app e clica em Guardar. Vê{" "}
            <FaqLink to="keys">onde obter chaves gratuitas</FaqLink>.
          </p>
          <p className="mb-3 text-muted-foreground text-xs">
            Faz dois ou três, não só um. Se um serviço estiver ocupado, a app passa sozinha para o seguinte.
          </p>

          <p className="text-foreground font-medium mb-1">2. Falar com ela</p>
          <p className="mb-3">
            Volta ao chat e escreve normalmente, como escreverias a um colega. Se quiseres, escolhe o modelo
            no seletor lá em cima — vê <FaqLink to="modes">Smartest / Fastest / Manual</FaqLink>.
          </p>

          <p className="text-foreground font-medium mb-1">3. Mudar para BUILD quando quiseres que ela faça coisas</p>
          <p className="mb-3">
            Por omissão a app está em modo <strong className="text-foreground">PLAN</strong>: só conversa. Para poder criar
            ficheiros, ler os teus documentos ou executar comandos, muda para{" "}
            <strong className="text-foreground">BUILD</strong> — o botão ao lado do seletor de modelos. Vê{" "}
            <FaqLink to="planbuild">PLAN e BUILD</FaqLink>.
          </p>

          <p className="text-foreground font-medium mb-1">4. Ligar os teus programas e contas (opcional)</p>
          <p className="mb-3">
            AutoCAD, Photoshop, Google Drive, Gmail, GitHub, WordPress e outros. Vai a{" "}
            <strong className="text-foreground">⚙ Providers</strong> → separador{" "}
            <strong className="text-foreground">CONNECTORS</strong>. Vê{" "}
            <FaqLink to="connectors">como ligar cada um</FaqLink>.
          </p>

          <p className="text-muted-foreground text-xs">
            Perdido na interface? <FaqLink to="menu">O que faz cada botão</FaqLink>.
          </p>
        </>
      ),
    },
    {
      id: "menu",
      q: "O que faz cada botão e cada zona do ecrã?",
      a: (
        <>
          <p className="text-foreground font-medium mb-1 mt-1">Em cima à direita (a fila de ícones)</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">📊 Analytics</strong> — quanto usaste, que modelos e quanto custou.</li>
            <li><strong className="text-foreground">🔧 Minhas Skills</strong> — receitas que ensinas uma vez e reutilizas. Vê <FaqLink to="skills">Skills</FaqLink>.</li>
            <li><strong className="text-foreground">🧠 Memórias</strong> — factos sobre ti que ela recorda em todas as conversas. Vê <FaqLink to="memories">Memórias</FaqLink>.</li>
            <li><strong className="text-foreground">⬇ Exportar</strong> — guarda a conversa em Markdown ou JSON. Só aparece quando já há mensagens.</li>
            <li><strong className="text-foreground">⚙ Providers</strong> — chaves de API e conectores. Quatro separadores: FREE, PAID, LOCAL e CONNECTORS.</li>
            <li><strong className="text-foreground">❓ FAQ</strong> — esta página.</li>
            <li><strong className="text-foreground">☀ / 🌙</strong> — tema claro ou escuro.</li>
            <li><strong className="text-foreground">PT / EN</strong> — idioma da interface.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">Barra da esquerda</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Projectos</strong> — agrupa conversas por assunto. Cada projecto pode ter instruções próprias e uma pasta de trabalho própria. Vê <FaqLink to="projects">Projectos</FaqLink>.</li>
            <li><strong className="text-foreground">Conversas</strong> — o teu histórico. Muda o nome ou apaga no menu ⋮ de cada uma.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">Por cima do chat</p>
          <ul className="list-disc list-inside mb-3 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Seletor de modelo</strong> — qual a IA que te responde.</li>
            <li><strong className="text-foreground">Smartest / Fastest / Manual</strong> — qual tenta primeiro. Vê <FaqLink to="modes">aqui</FaqLink>.</li>
            <li><strong className="text-foreground">PLAN / BUILD</strong> — se pode ou não mexer no teu computador. Vê <FaqLink to="planbuild">aqui</FaqLink>.</li>
            <li><strong className="text-foreground">Instruções do sistema</strong> — regras para toda a conversa. Vê <FaqLink to="system">aqui</FaqLink>.</li>
          </ul>

          <p className="text-foreground font-medium mb-1">À volta da caixa de escrever</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">📎</strong> — anexar ficheiros (PDF, Word, Excel, imagens, código).</li>
            <li><strong className="text-foreground">⭐</strong> — textos que guardas para reutilizar. Vê <FaqLink to="prompts">aqui</FaqLink>.</li>
            <li><strong className="text-foreground">→</strong> — enviar. Enquanto ela responde, passa a ser um botão de parar.</li>
            <li>Passa o rato por cima de uma mensagem tua para a <strong className="text-foreground">editar e reenviar</strong>, ou por cima de uma resposta para a <strong className="text-foreground">gerar de novo</strong>.</li>
          </ul>
        </>
      ),
    },
    {
      id: "models",
      q: "Porque é que não vejo nenhum modelo no seletor?",
      a: "Precisas de configurar pelo menos uma chave de API primeiro. Vai a ⚙ Providers, escolhe um provider (por exemplo Groq, que é grátis), adiciona a tua chave e clica em Guardar. Os modelos aparecem depois na lista.",
    },
    {
      id: "keys",
      q: "Onde obtenho chaves de API gratuitas?",
      a: (
        <>
          Cada provider tem um link "Obter API Key" ao lado do nome. Aqui estão os mais fáceis e gratuitos:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Groq:</strong> console.groq.com — o mais rápido</li>
            <li><strong className="text-foreground">Gemini:</strong> aistudio.google.com — nível gratuito da Google</li>
            <li><strong className="text-foreground">Cerebras:</strong> cloud.cerebras.ai — muito rápido, com nível gratuito</li>
            <li><strong className="text-foreground">OpenRouter:</strong> openrouter.ai — muitos modelos num só sítio</li>
            <li><strong className="text-foreground">Mistral:</strong> console.mistral.ai — europeu, plano experimental gratuito</li>
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">Alguns só mostram a chave uma vez — copia-a logo.</p>
        </>
      ),
    },
    {
      id: "planbuild",
      q: "Qual é a diferença entre PLAN e BUILD?",
      a: (
        <>
          <p className="mb-2">É o botão ao lado do seletor de modelos, e decide o que o assistente pode fazer.</p>
          <ul className="list-disc list-inside mb-2 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">PLAN</strong> (por omissão) — só conversa. Responde, explica e planeia, mas nunca toca nos teus ficheiros nem nas tuas contas.</li>
            <li><strong className="text-foreground">BUILD</strong> — pode ler e escrever ficheiros, executar comandos, criar documentos Excel/Word/PowerPoint e usar os teus conectores (Drive, AutoCAD, GitHub...).</li>
          </ul>
          <p className="text-muted-foreground text-xs">Se lhe pedires para criar um ficheiro e não acontecer nada, quase de certeza que estás em PLAN.</p>
        </>
      ),
    },
    {
      id: "connectors",
      q: "Como ligo o AutoCAD, o Photoshop, o Google Drive, o GitHub e os outros?",
      a: (
        <>
          <p className="mb-2">⚙ Providers → separador <strong className="text-foreground">CONNECTORS</strong>. Tudo usa as tuas próprias contas — nada é partilhado com mais ninguém. Não te esqueças de estar em modo <FaqLink to="planbuild">BUILD</FaqLink> para os poderes usar.</p>
          <p className="text-foreground font-medium mb-1">Um clique, sem instalar nada</p>
          <ul className="list-disc list-inside mb-3 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">AutoCAD</strong> (só Windows) — abre primeiro o AutoCAD e só depois clica em Ligar. Da primeira vez demora 1 a 3 minutos, enquanto a app descarrega o que precisa.</li>
            <li><strong className="text-foreground">Photoshop / Premiere Pro</strong> — precisas do Creative Cloud Desktop instalado. No fim abre-se o instalador do plugin; dentro do programa, clica em Connect no painel do plugin.</li>
          </ul>
          <p className="text-foreground font-medium mb-1">Entrar com a tua conta</p>
          <ul className="list-disc list-inside mb-3 space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">Google Drive / Gmail</strong> — clica em Ligar, entra com a tua conta Google e aprova. Passa a poder ler os teus ficheiros ou o teu email, e enviar mensagens em teu nome.</li>
            <li><strong className="text-foreground">Canva</strong> — a mesma ideia, entras com a tua conta Canva.</li>
          </ul>
          <p className="text-foreground font-medium mb-1">Colar uma chave ou palavra-passe</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li><strong className="text-foreground">GitHub</strong> — um Personal Access Token (há um link que já leva as permissões certas preenchidas).</li>
            <li><strong className="text-foreground">WordPress</strong> — o endereço do site, o teu utilizador e uma Application Password gerada no teu perfil do WordPress.</li>
            <li><strong className="text-foreground">n8n</strong> — o endereço da tua instância e uma API key (Definições → n8n API).</li>
            <li><strong className="text-foreground">Magnific</strong> — a tua chave da Freepik/Magnific, para melhorar e gerar imagens.</li>
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">Se um cartão mostrar uma caixa vermelha, o servidor desse conector não arrancou — a mensagem diz-te porquê.</p>
        </>
      ),
    },
    {
      id: "modes",
      q: "O que significam Smartest, Fastest e Manual?",
      a: (
        <>
          Decidem que modelo a app tenta primeiro, quando há mais do que um disponível:
          <ul className="list-disc list-inside mt-2 space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Smartest</strong> — tenta primeiro o modelo mais capaz. Bom para perguntas difíceis, raciocínio e código.</li>
            <li><strong className="text-foreground">Fastest</strong> — tenta primeiro o modelo mais rápido a responder. Bom para respostas rápidas.</li>
            <li><strong className="text-foreground">Manual</strong> — usa os modelos pela ordem em que aparecem na lista, sem a mudar.</li>
          </ul>
          <p className="mt-2">Nos três casos, se o primeiro modelo falhar, a app tenta automaticamente o seguinte.</p>
        </>
      ),
    },
    {
      id: "projects",
      q: "Para que servem os Projectos?",
      a: (
        <>
          <p className="mb-2">Na barra da esquerda podes agrupar conversas em projectos — um por cliente, por obra, por assunto.</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Cada projecto tem as suas <strong className="text-foreground">instruções</strong>, aplicadas a todas as conversas lá dentro.</li>
            <li>Cada projecto pode ter uma <strong className="text-foreground">pasta de trabalho</strong>: em modo BUILD, é aí que os ficheiros são lidos e escritos por omissão.</li>
          </ul>
        </>
      ),
    },
    {
      id: "system",
      q: "Para que servem as Instruções do Sistema?",
      a: (
        <>
          <p className="mb-2">A barra de instruções do sistema (logo acima do chat) permite definir como o modelo se deve comportar durante <strong className="text-foreground">toda a conversa</strong>.</p>
          <p className="mb-2"><strong className="text-foreground">A grande vantagem:</strong> em vez de escrever "responde de forma concisa, usando Python para exemplos" em cada mensagem, escreves uma vez no topo e o modelo segue automaticamente.</p>
          <p className="mb-1 text-foreground">Exemplos reais:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li>Código → <em>"Age como engenheiro sénior. Mostra sempre código limpo."</em></li>
            <li>Escrita → <em>"Escreve de forma persuasiva, frases curtas."</em></li>
            <li>Aprendizagem → <em>"Explica tudo como se eu fosse iniciante."</em></li>
            <li>Tradução → <em>"Traduz tudo o que eu escrevo para inglês formal."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Guarda automaticamente. Cada conversa tem as suas próprias instruções.</p>
        </>
      ),
    },
    {
      id: "skills",
      q: "O que são as Skills (🔧)?",
      a: (
        <>
          <p className="mb-2">Uma skill é uma receita que escreves uma vez e que o assistente segue sempre que for relevante — a tua maneira de fazer uma tarefa que se repete.</p>
          <p className="mb-1 text-foreground">Por exemplo:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li><em>"Quando eu pedir um relatório, usa sempre esta estrutura e esta capa."</em></li>
            <li><em>"Quando eu pedir um desenho, trabalha sempre em milímetros e na layer 0."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Cria e edita na página 🔧 Minhas Skills.</p>
        </>
      ),
    },
    {
      id: "prompts",
      q: "Para que serve a Biblioteca de Prompts (⭐)?",
      a: (
        <>
          O botão ⭐ ao lado da caixa de escrever guarda textos que uses muitas vezes, para não os teres de escrever outra vez.
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Clica em <strong className="text-foreground">⭐</strong> para abrir a lista</li>
            <li>Clica em <strong className="text-foreground">"Guardar atual"</strong> para guardar o que escreveste</li>
            <li>Clica num texto guardado para o pôr na caixa de escrever</li>
            <li>Passa o rato por cima e clica em <strong className="text-foreground">×</strong> para apagar</li>
          </ul>
          <p className="mt-2">Tudo fica guardado no teu computador, mesmo depois de fechares a app.</p>
        </>
      ),
    },
    {
      id: "memories",
      q: "Para que servem as Memórias (🧠)?",
      a: (
        <>
          <p className="mb-2">A página 🧠 Memórias permite guardar factos pessoais que o assistente vai usar em <strong className="text-foreground">todas as conversas</strong>.</p>
          <p className="mb-1 text-foreground">Exemplos de memórias úteis:</p>
          <ul className="list-disc list-inside mb-2 space-y-1 text-muted-foreground">
            <li><em>"Sou arquitecto e trabalho todos os dias em AutoCAD."</em></li>
            <li><em>"Prefiro respostas concisas com exemplos."</em></li>
            <li><em>"Responde sempre em português."</em></li>
          </ul>
          <p className="text-muted-foreground text-xs">Adiciona factos com o botão 🧠 no cabeçalho. Ficam guardados no teu computador e são usados em cada conversa.</p>
        </>
      ),
    },
    {
      id: "artifacts",
      q: "O que são os Artefactos (▶ Preview)?",
      a: (
        <>
          Quando o modelo gera código HTML ou SVG, aparece um botão <strong className="text-foreground">▶ Preview</strong> no bloco de código. Clica nele para abrir um painel de pré-visualização ao vivo no lado direito.
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Páginas HTML, componentes e gráficos aparecem em tempo real</li>
            <li>SVGs mostram-se com as proporções corretas</li>
            <li>Usa <strong className="text-foreground">Abrir em nova janela</strong> para ver o resultado completo</li>
          </ul>
        </>
      ),
    },
  ]

  return lang === "pt" ? pt : en
}

export default function FAQPage({ onNavigate, lang }: { onNavigate: (p: Page) => void; lang: Lang }) {
  const faqs = faqContent(lang)

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-foreground font-bold text-lg">❓ FAQ</h1>
          <button onClick={() => onNavigate("chat")} className="text-muted-foreground hover:text-foreground transition-colors text-sm">← {lang === "pt" ? "Voltar ao chat" : "Back to chat"}</button>
        </div>
      </header>
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        {faqs.map((f, i) => (
          // The first entry is the guided walkthrough — open by default so a
          // first-time user lands on instructions, not on a wall of closed rows.
          <details key={f.id} id={f.id} open={i === 0} className="bg-card border border-border rounded-xl overflow-hidden group scroll-mt-4">
            <summary className="text-foreground font-medium text-sm px-4 py-3 cursor-pointer hover:bg-secondary/50 transition-colors flex items-center justify-between">
              <span>{f.q}</span>
              <span className="text-muted-foreground group-open:hidden">▶</span>
              <span className="text-muted-foreground hidden group-open:inline">▼</span>
            </summary>
            <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3 mt-0">
              {f.a}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
