// src/ui/LeftToday.tsx
// A seção "Left today" da tela de Uso: quanto sobra HOJE em cada lugar com
// cota grátis — os tokens do data-sharing da OpenAI, os pedidos por modelo do
// Gemini, os grátis do OpenRouter, o dia do NIM.
//
// Ela não depende do período nem dos filtros da página: cota é do dia, e o
// dia é o de cada provider (ver usage/sobraDoDia.ts). Por isso mora no TOPO,
// antes do seletor de período — que é a régua só do que vem abaixo dele.
//
// O medidor é de BATERIA: a barra é o que SOBRA e encurta conforme se usa,
// porque a pergunta da seção é "quanto ainda tenho", não "quanto gastei".
// Sem teto conhecido não há barra — uma barra inventada seria dado inventado;
// fica o número do dia, e no Gemini o botão pra pessoa trazer o teto dela.
//
// Cada provider é um ACORDEÃO. Fechado, só as barras: o "quanto sobra" de
// relance, sem uma palavra — a cor avisa quando está acabando. Aberto, o
// texto: os nomes, quanto sobra, a conta ("238 of 250 used"), o teto e a
// explicação de onde vem o número. O que fica aberto é lembrado por vault,
// neste aparelho: é preferência de tela, não dado.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { App } from "obsidian";
import type AxxaPlugin from "../main";
import { getProvider } from "../providers";
import type { EstadoDaChave } from "../providers/openrouter";
import { prettyModelName } from "../providers/modelDescriptions";
import { formatCompact } from "../usage/format";
import {
  CHAVE_LIMITE_GASTO,
  emQuanto,
  fracaoQueSobra,
  nivel,
  sobraDoDia,
  type Cartao,
  type Medidor,
} from "../usage/sobraDoDia";
import { usd } from "../usage/gastoDoDia";
import { providerIcon } from "./ChatList";
import { Icon } from "./Icon";
import { localeDaInterface, tr } from "../i18n/tr";

/** Onde mora (no localStorage do vault) quais blocos ficaram abertos. */
const CHAVE_ABERTOS = "axxa-left-today-open";

function lerAbertos(app: App): Set<string> {
  try {
    const v: unknown = app.loadLocalStorage(CHAVE_ABERTOS);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function gravarAbertos(app: App, abertos: Set<string>): void {
  try {
    app.saveLocalStorage(CHAVE_ABERTOS, abertos.size ? Array.from(abertos) : null);
  } catch {
    // Sem armazenamento (janela privada, cota cheia): a escolha vale até a
    // tela fechar, e só.
  }
}

/** Pedidos são poucos e contados um a um: "1,000", não "1.0k". Tokens são
 *  muitos, e o compacto é o que se lê ("238k"). */
function numero(n: number, unidade: Medidor["unidade"]): string {
  if (unidade === "usd") return usd(n);
  return unidade === "tokens" ? formatCompact(n) : Math.round(n).toLocaleString(localeDaInterface());
}

/** O número com a unidade: "238k tokens", "12 requests", "1 request". */
function quantos(n: number, unidade: Medidor["unidade"]): string {
  if (unidade === "tokens") return tr("{n} tokens", { n: numero(n, unidade) });
  if (unidade === "usd") return numero(n, unidade);
  return n === 1 ? tr("1 request") : tr("{n} requests", { n: numero(n, unidade) });
}

/** "238 left". Um só sobrando é singular em português ("resta 1"); dinheiro
 *  não entra nessa conta ("$1.00 left" continua plural). */
function sobram(n: number, unidade: Medidor["unidade"]): string {
  return n === 1 && unidade !== "usd" ? tr("1 left") : tr("{n} left", { n: numero(n, unidade) });
}

/** A conta do pé: "238 of 250 requests used". O plural é o do teto. */
function usadosDe(usado: number, limite: number, unidade: Medidor["unidade"]): string {
  const u = numero(usado, unidade);
  if (unidade === "usd") return tr("{used} of {limit} spent", { used: u, limit: numero(limite, unidade) });
  if (unidade === "tokens") {
    return tr("{used} of {limit} tokens used", { used: u, limit: numero(limite, unidade) });
  }
  return limite === 1
    ? tr("{used} of 1 request used", { used: u })
    : tr("{used} of {limit} requests used", { used: u, limit: numero(limite, unidade) });
}

/** Dinheiro de crédito e de gasto do dia: centavos bastam ("$0.31"); a casa
 *  a mais do formatUsd ("$0.310") é pra preço por conversa, não pra saldo. */
function dinheiro(n: number): string {
  if (n === 0) return "$0.00";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** De quanto em quanto o teto da chave volta, no valor que o OpenRouter
 *  manda ("daily", "weekly", "monthly"); um valor novo vai como veio. */
function voltaDoCredito(volta: string): string {
  if (volta === "daily") return tr("resets daily");
  if (volta === "weekly") return tr("resets weekly");
  if (volta === "monthly") return tr("resets monthly");
  return tr("resets {when}", { when: volta });
}

/** O nome de um medidor na tela: o do app pro modelo ("Gemini 2.5 Flash"),
 *  o rótulo pro resto ("Flagship models"). */
function nomeDo(m: Medidor): string {
  return m.modelo ? prettyModelName(m.modelo) : m.rotulo;
}

export function LeftToday({ plugin }: { plugin: AxxaPlugin }) {
  const s = plugin.settings;

  // O relógio da seção: o "resets in" anda, e o dia vira com a tela aberta.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const [abertos, setAbertos] = useState(() => lerAbertos(plugin.app));
  const alternar = (provider: string) => {
    const novo = new Set(abertos);
    if (novo.has(provider)) novo.delete(provider);
    else novo.add(provider);
    setAbertos(novo);
    gravarAbertos(plugin.app, novo);
  };

  // O OpenRouter conta os grátis da CHAVE (qualquer app que a use): pergunta
  // ao abrir a tela e quando a pessoa pede de novo.
  const chaveOR = plugin.providerCredential("openrouter").trim();
  const [viva, setViva] = useState<EstadoDaChave | null | undefined>(undefined);
  const [lendo, setLendo] = useState(false);
  const perguntar = useCallback(async () => {
    if (!chaveOR) return;
    setLendo(true);
    try {
      setViva((await getProvider("openrouter").keyStatus?.(chaveOR)) ?? null);
      setAgora(new Date());
    } finally {
      setLendo(false);
    }
  }, [chaveOR]);
  useEffect(() => {
    void perguntar();
  }, [perguntar]);

  const salvarLimite = (chave: string, n: number | null) => {
    if (chave === CHAVE_LIMITE_GASTO) {
      s.limiteGastoDiario = n ?? 0;
      void plugin.saveSettings();
      return;
    }
    const limites = (s.limitesDiarios ??= {});
    if (n == null) delete limites[chave];
    else limites[chave] = n;
    void plugin.saveSettings();
  };

  const cartoes = sobraDoDia({
    livro: s.usoDoDia ?? {},
    agora,
    comChave: (id) => !!plugin.providerCredential(id).trim(),
    openai: { dataSharing: s.openaiDataSharing === true, tier: s.openaiTier ?? 1 },
    limites: s.limitesDiarios ?? {},
    cotaOpenRouter: s.freeQuota?.openrouter,
    chaveOpenRouter: viva,
    limiteGasto: s.limiteGastoDiario ?? 0,
    travarNoLimite: s.travarNoLimite === true,
    geminiFreeTier: s.geminiFreeTier === true,
  });
  if (cartoes.length === 0) return null;

  return (
    <section className="axxa-home-block axxa-left" aria-label={tr("Left today")}>
      <div className="axxa-home-headrow">
        <span className="axxa-section-label">{tr("Left today")}</span>
      </div>
      <div className="axxa-usage-list">
        {cartoes.map((c) => (
          <CartaoDoDia
            key={c.provider}
            c={c}
            aberto={abertos.has(c.provider)}
            onAlternar={() => alternar(c.provider)}
            onSalvarLimite={salvarLimite}
            atualizar={
              c.provider === "openrouter" && chaveOR
                ? { lendo, ir: () => void perguntar() }
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

/** Um provider: o cabeçalho que abre e fecha; fechado, as barras; aberto, o
 *  texto todo. */
function CartaoDoDia({
  c,
  aberto,
  onAlternar,
  onSalvarLimite,
  atualizar,
}: {
  c: Cartao;
  aberto: boolean;
  onAlternar: () => void;
  onSalvarLimite: (chave: string, n: number | null) => void;
  /** Só o OpenRouter: perguntar de novo à chave. */
  atualizar?: { lendo: boolean; ir: () => void };
}) {
  const idCorpo = `axxa-left-${c.provider}`;
  // Fechado, só o que tem barra: um modelo sem teto não tem o que desenhar.
  const comBarra = c.medidores.filter((m) => fracaoQueSobra(m) != null);
  return (
    <div className={aberto ? "axxa-left-prov is-open" : "axxa-left-prov"}>
      <button
        type="button"
        className="axxa-left-head"
        aria-expanded={aberto}
        aria-controls={idCorpo}
        onClick={onAlternar}
      >
        <span className="axxa-card-mark" aria-hidden="true">
          <Icon name={c.provider === "spend" ? "wallet" : providerIcon(c.provider)} size={20} />
        </span>
        <span className="axxa-left-name">{c.nome}</span>
        {aberto && (c.viraEm != null || c.semDia) && (
          <span
            className="axxa-left-reset"
            title={c.viraOnde ? tr("Resets at {when}", { when: c.viraOnde }) : undefined}
          >
            {c.viraEm != null ? tr("resets in {time}", { time: emQuanto(c.viraEm) }) : c.semDia}
          </span>
        )}
        <span className="axxa-left-chev" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </button>

      {aberto ? (
        <div className="axxa-left-body" id={idCorpo}>
          {c.vazio && <p className="axxa-left-note">{c.vazio}</p>}
          {c.medidores.map((m) => (
            <LinhaDoMedidor
              key={m.id}
              m={m}
              ajuda={c.link}
              atualizar={m.id === "openrouter-free" ? atualizar : undefined}
              onSalvarLimite={onSalvarLimite}
            />
          ))}
          {c.credito && <LinhaDoCredito credito={c.credito} />}
          {c.nota && (
            <p className="axxa-left-note">
              {c.nota}
              {c.link && (
                <>
                  {" "}
                  <a
                    className="axxa-left-link"
                    href={c.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {c.link.rotulo}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        comBarra.length > 0 && (
          // Tocar nas barras também abre — o botão de verdade (pro teclado e
          // pro leitor de tela) é o cabeçalho, logo acima.
          <div className="axxa-left-bars" id={idCorpo} onClick={onAlternar}>
            {comBarra.map((m) => (
              <Barra key={m.id} m={m} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

/**
 * A barra de um medidor — a mesma fechado (sozinha) e aberto (na linha). O
 * nível (quase no fim, acabou) mora NELA: fechado, ela é o único aviso. O
 * leitor de tela ouve o número que o olho não vê.
 */
function Barra({ m }: { m: Medidor }) {
  const f = fracaoQueSobra(m);
  if (f == null || m.limite == null || m.restante == null) return null;
  const n = nivel(m);
  const texto =
    m.restante === 1 && m.unidade !== "usd"
      ? tr("{name}: 1 of {limit} left", { name: nomeDo(m), limit: numero(m.limite, m.unidade) })
      : tr("{name}: {left} of {limit} left", {
          name: nomeDo(m),
          left: numero(m.restante, m.unidade),
          limit: numero(m.limite, m.unidade),
        });
  return (
    <span
      className={n ? `axxa-left-bar is-${n}` : "axxa-left-bar"}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={m.limite}
      aria-valuenow={m.restante}
      aria-label={texto}
      title={texto}
    >
      <span className="axxa-left-fill" style={{ "--axxa-left": f } as CSSProperties} />
    </span>
  );
}

/**
 * Um medidor aberto: o nome e o que sobra na linha de cima, a barra embaixo
 * (só com teto conhecido), e a conta no pé — "238 of 250 requests used".
 */
function LinhaDoMedidor({
  m,
  ajuda,
  atualizar,
  onSalvarLimite,
}: {
  m: Medidor;
  /** Onde a pessoa acha o teto que vai informar (o AI Studio). */
  ajuda?: { rotulo: string; url: string };
  /** Os grátis do OpenRouter: perguntar de novo à chave. */
  atualizar?: { lendo: boolean; ir: () => void };
  onSalvarLimite: (chave: string, n: number | null) => void;
}) {
  const nome = nomeDo(m);
  const n = nivel(m);
  const dinheiro = m.unidade === "usd";
  const valor =
    m.restante != null
      ? sobram(m.restante, m.unidade)
      : dinheiro
        ? tr("{n} spent", { n: numero(m.usado, m.unidade) })
        : quantos(m.usado, m.unidade);
  const conta =
    m.limite != null
      ? usadosDe(m.usado, m.limite, m.unidade)
      : m.limiteEditavel
        ? tr("No daily limit set")
        : null;
  const pe = [conta, m.nota].filter(Boolean).join(" · ");
  return (
    <div className={n ? `axxa-left-row is-${n}` : "axxa-left-row"}>
      <span className="axxa-left-row-name">{nome}</span>
      <span className="axxa-left-row-value">{valor}</span>
      <Barra m={m} />
      {pe && <span className="axxa-left-row-sub">{pe}</span>}
      {m.limiteEditavel ? (
        <EditorDeLimite
          atual={m.limite}
          nome={nome}
          ajuda={ajuda}
          dinheiro={dinheiro}
          onSalvar={(v) => onSalvarLimite(m.limiteEditavel!, v)}
        />
      ) : (
        atualizar && (
          <button
            type="button"
            className="axxa-home-filter is-accent axxa-left-action"
            aria-label={tr("Ask OpenRouter again")}
            disabled={atualizar.lendo}
            onClick={atualizar.ir}
          >
            <Icon name={atualizar.lendo ? "loader" : "refresh-cw"} size={14} />
            <span>{atualizar.lendo ? tr("Asking…") : tr("Refresh")}</span>
          </button>
        )
      )}
    </div>
  );
}

/**
 * O teto que a pessoa informa (Gemini): um botão de texto que vira campo — e,
 * com o campo aberto, a linha que diz onde achar o número. Sem salvar ao
 * perder o foco: tocar no ✓ tira o foco do campo ANTES do toque chegar no
 * botão, e o campo sumiria debaixo do dedo. Vazio apaga o teto.
 */
function EditorDeLimite({
  atual,
  nome,
  ajuda,
  dinheiro = false,
  onSalvar,
}: {
  atual?: number;
  nome: string;
  ajuda?: { rotulo: string; url: string };
  /** Teto em dólar (com centavos), não em pedidos. */
  dinheiro?: boolean;
  onSalvar: (n: number | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [txt, setTxt] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  // O campo nasce de um toque no "Set limit": o foco vai pra onde a pessoa
  // acabou de pedir. Por ref, e não pelo atributo autofocus — num campo
  // inserido depois que a página carregou, o navegador pode ignorá-lo.
  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);
  if (!aberto) {
    return (
      <button
        type="button"
        className="axxa-home-filter is-accent axxa-left-action"
        aria-label={
          dinheiro
            ? atual
              ? tr("Edit the daily spending limit")
              : tr("Set the daily spending limit")
            : atual
              ? tr("Edit the daily limit for {name}", { name: nome })
              : tr("Set the daily limit for {name}", { name: nome })
        }
        onClick={() => {
          setTxt(atual ? String(atual) : "");
          setAberto(true);
        }}
      >
        <span>{atual ? tr("Edit") : tr("Set limit")}</span>
      </button>
    );
  }
  // Lê o CAMPO, não o estado: o render que leva o último dígito pro estado
  // pode ainda não ter rodado quando o Enter chega.
  const salvar = () => {
    const bruto = (campo.current?.value ?? txt).trim().replace(",", ".");
    const v = Number(bruto);
    const valido = bruto && Number.isFinite(v) && v > 0;
    onSalvar(valido ? (dinheiro ? Math.round(v * 100) / 100 : Math.floor(v)) : null);
    setAberto(false);
  };
  return (
    <>
      <span className="axxa-left-action axxa-left-edit">
        <input
          type="number"
          inputMode="numeric"
          min={dinheiro ? 0 : 1}
          step={dinheiro ? 0.5 : 1}
          className="axxa-left-input"
          value={txt}
          placeholder={dinheiro ? tr("$ a day") : tr("Per day")}
          aria-label={
            dinheiro ? tr("Daily spending limit in dollars") : tr("Requests per day for {name}", { name: nome })
          }
          ref={campo}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") setAberto(false);
          }}
        />
        <button
          type="button"
          className="axxa-icon-btn"
          aria-label={tr("Save limit")}
          onClick={salvar}
        >
          <Icon name="check" />
        </button>
      </span>
      {ajuda && (
        <span className="axxa-left-row-hint">
          {tr("Requests per day.")}{" "}
          <a
            className="axxa-left-link"
            href={ajuda.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ajuda.rotulo}
          </a>
        </span>
      )}
    </>
  );
}

/** O crédito da chave do OpenRouter — dinheiro, sem barra (o teto da chave
 *  não é do dia, então uma barra "do dia" mentiria). */
function LinhaDoCredito({
  credito,
}: {
  credito: NonNullable<Cartao["credito"]>;
}) {
  const comTeto = credito.restante != null;
  const pe = comTeto
    ? [
        credito.gastoHoje != null
          ? tr("{amount} spent today", { amount: dinheiro(credito.gastoHoje) })
          : null,
        credito.volta ? voltaDoCredito(credito.volta) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : tr("No spending cap on this key");
  return (
    <div className="axxa-left-row">
      <span className="axxa-left-row-name">
        {comTeto ? tr("Key credit") : tr("Spent today")}
      </span>
      <span className="axxa-left-row-value">
        {comTeto
          ? tr("{n} left", { n: dinheiro(credito.restante ?? 0) })
          : dinheiro(credito.gastoHoje ?? 0)}
      </span>
      {pe && <span className="axxa-left-row-sub">{pe}</span>}
    </div>
  );
}
