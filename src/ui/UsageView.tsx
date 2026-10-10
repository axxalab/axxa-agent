// src/ui/UsageView.tsx
// A página de USO: o cartão da home aberto, com o recorte na sua mão.
//
// O cartão responde "quanto, como e com quê" de relance e cabe em três linhas.
// Esta tela existe pras perguntas que não cabem ali e que sempre chegam
// depois: "quanto foi só o Opus?", "e no Agent?", "e na semana passada?".
//
// Ela não recalcula nada por conta própria — filtra as conversas e entrega a
// mesma agregação de sempre (usage/aggregate), a mesma do relatório. Dois
// caminhos pra mesma conta acabariam discordando, e é justamente aqui, onde
// se confere dinheiro, que discordar custa a confiança da tela inteira.
//
// O recorte é aplicado ANTES de somar: com ele aplicado no fim, o total diria
// uma coisa e a tabela outra.
//
// O DESENHO é o do resto do app, peça por peça: o número grande e os módulos
// são os do cartão da home; o período é o segmented da home; os filtros são
// as pílulas das folhas (com a contagem em expoente, como as categorias de
// ícone); e cada modelo leva o anel da fatia que o cartão já usa — aqui com o
// logo dentro, porque a página tem o espaço que o cartão não tem.

import { useMemo, useState, type CSSProperties } from "react";
import { Notice } from "obsidian";
import type AxxaPlugin from "../main";
import type { ChatSession } from "../core/session";
import { useChatSummaries, providerIcon } from "./ChatList";
import { Icon } from "./Icon";
import { Segmented } from "./Segmented";
import { aggregateFromSummaries, type ChatUsageRow } from "../usage/aggregate";
import { formatUsd, formatUsdRounded } from "../usage/pricing";
import { formatCompact } from "../usage/format";
import { saveUsageMarkdown } from "../usage/export";
import {
  FILTRO_VAZIO,
  alternar,
  aplicar,
  opcoes,
  type Opcao,
  type UsageFilter,
} from "../usage/filters";
import {
  A_VISTA,
  buscarOpcoes,
  conversasDoTopo,
  faixaDeDatas,
  marcados,
  mediaPorConversa,
  metricaDa,
  modelosDaPagina,
  opcoesAVista,
  relatorioDe,
  semADimensao,
  valeFiltrar,
  type Fatia,
  type Metrica,
} from "../usage/page";
import {
  janelaDoGrafico,
  passoDe,
  picoDa,
  serieDoTempo,
  diasEntre,
  type Coluna,
  type Passo,
} from "../usage/timeline";
import { Sheet, SheetNote, SheetSearch } from "./Sheet";
import { moduleIcon, moduleLabel, relativeShort } from "./modules";
import { PROVIDERS } from "../core/providersMeta";
import { prettyModelName } from "../providers/modelDescriptions";
import { modelLogo } from "../providers/modelLogo";
import { LeftToday } from "./LeftToday";
import { marca, tr } from "../i18n/tr";

/** Janelas do período, em dias (0 = tudo). O id é o número em texto. */
const PERIODOS = [
  { id: "0", label: marca("All time") },
  { id: "7", label: marca("7 days") },
  { id: "30", label: marca("30 days") },
  { id: "90", label: marca("90 days") },
];

/** Quantas conversas a lista do topo mostra. */
const TOPO = 10;

/** A partir de quantas opções a lista inteira ganha busca. Com poucas, o
 *  campo seria uma linha a mais pra ler antes de chegar no que se procura. */
const BUSCA_A_PARTIR = 8;

/** Como o passo do gráfico se chama na tela. */
const PASSO: Record<Passo, string> = {
  day: marca("Daily"),
  week: marca("Weekly"),
  month: marca("Monthly"),
};

/** Os filtros de lista: o que cada dimensão marca, como se chama e se desenha. */
type Dimensao = "providers" | "models" | "modes";

export function UsageView({
  plugin,
  session,
  filtro: f,
  onFiltro: setF,
  onBack,
  onOpenChat,
}: {
  plugin: AxxaPlugin;
  session: ChatSession;
  /** O recorte. Mora no App: abrir uma conversa daqui desmonta esta tela, e
   *  a volta tem que achar o recorte onde ele estava. */
  filtro: UsageFilter;
  onFiltro: (f: UsageFilter) => void;
  onBack: () => void;
  /** Uma conversa da lista foi aberta — a tela troca pra ela. */
  onOpenChat: () => void;
}) {
  const chats = useChatSummaries(plugin);
  const [salvando, setSalvando] = useState(false);
  /** A lista inteira de uma dimensão (o "See all"). A dimensão fica guardada
   *  mesmo com a folha fechada: ela desce DESLIZANDO, e o conteúdo tem que
   *  continuar lá durante a descida em vez de sumir no primeiro quadro. */
  const [lista, setLista] = useState<Dimensao>("models");
  const [listaAberta, setListaAberta] = useState(false);
  const [buscaLista, setBuscaLista] = useState("");

  // As opções saem das conversas INTEIRAS, não do recorte: se elas
  // encolhessem junto, marcar um provider apagaria os outros da lista e não
  // haveria como desmarcar.
  const porProvider = useMemo(() => opcoes(chats, "provider"), [chats]);
  const porModelo = useMemo(() => opcoes(chats, "model"), [chats]);
  const porModo = useMemo(() => opcoes(chats, "mode"), [chats]);

  const recorte = useMemo(() => aplicar(chats, f), [chats, f]);
  const agg = useMemo(() => aggregateFromSummaries(recorte, 0), [recorte]);
  const m = metricaDa(agg.total);
  const modelos = useMemo(() => modelosDaPagina(agg), [agg]);
  const topo = useMemo(() => conversasDoTopo(agg, TOPO), [agg]);
  const media = mediaPorConversa(agg.total);

  const dimensoes: Array<{
    chave: Dimensao;
    titulo: string;
    /** O título da lista inteira ("Models"). */
    plural: string;
    /** O campo de busca da lista inteira ("Search models"). */
    busca: string;
    ops: Opcao[];
    nome: (id: string) => string;
    icone: (id: string) => string;
  }> = [
    {
      chave: "providers",
      titulo: tr("Provider"),
      plural: tr("Providers"),
      busca: tr("Search providers"),
      ops: porProvider,
      nome: (id) => PROVIDERS.find((p) => p.id === id)?.name ?? id,
      icone: providerIcon,
    },
    // O nome do APP, nunca o id da API: "claude-sonnet-4-6" é como o
    // provider chama; no resto do app ele é "Sonnet 4.6".
    {
      chave: "models",
      titulo: tr("Model"),
      plural: tr("Models"),
      busca: tr("Search models"),
      ops: porModelo,
      nome: prettyModelName,
      icone: modelLogo,
    },
    {
      chave: "modes",
      titulo: tr("Mode"),
      plural: tr("Modes"),
      busca: tr("Search modes"),
      ops: porModo,
      nome: moduleLabel,
      icone: moduleIcon,
    },
  ];
  const visiveis = dimensoes.filter((d) => valeFiltrar(d.ops, f[d.chave]));
  const naLista = dimensoes.find((d) => d.chave === lista) ?? dimensoes[1];
  // O relatório do "See all": o recorte da página MENOS o filtro da própria
  // dimensão (ver semADimensao) — a mesma soma de sempre, só recortada.
  const aggLista = useMemo(
    () => aggregateFromSummaries(aplicar(chats, semADimensao(f, lista)), 0),
    [chats, f, lista]
  );
  const mLista = metricaDa(aggLista.total);

  // A série do gráfico: o mesmo `byDay` do recorte, no passo que couber.
  const serie = useMemo((): { colunas: Coluna[]; passo: Passo } => {
    const j = janelaDoGrafico(f.days, agg.byDay);
    if (!j) return { colunas: [], passo: "day" };
    const passo = passoDe(diasEntre(j.de, j.ate));
    return { colunas: serieDoTempo(agg.byDay, j.de, j.ate, passo), passo };
  }, [agg, f.days]);
  const achadas = buscarOpcoes(naLista.ops, buscaLista, naLista.nome);
  const relatorio = relatorioDe(
    achadas,
    lista === "providers"
      ? aggLista.byProvider
      : lista === "models"
        ? aggLista.byModel
        : aggLista.byMode,
    aggLista.total
  );
  // De QUÊ é o relatório: o período e os filtros das outras dimensões, que
  // continuam valendo nele. Sem isto, os números da folha não batem com
  // nada que a pessoa consiga apontar.
  const escopo = [
    f.days === 0 ? tr("All time") : tr("Last {n} days", { n: f.days }),
    ...dimensoes
      .filter((d) => d.chave !== lista)
      .flatMap((d) => f[d.chave].map(d.nome)),
    contagem(aggLista.total.chats),
    mLista === "cost"
      ? formatUsdRounded(aggLista.total.cost)
      : tr("{n} tokens", {
          n: formatCompact(aggLista.total.tokensIn + aggLista.total.tokensOut),
        }),
  ];

  const verTodos = (d: Dimensao) => {
    setLista(d);
    setBuscaLista("");
    setListaAberta(true);
  };

  const salvarRelatorio = async () => {
    setSalvando(true);
    try {
      // O relatório é do RECORTE, não do vault inteiro: foi o recorte que a
      // pessoa montou, e é dele que ela quer o documento.
      const r = await saveUsageMarkdown(
        plugin.app,
        agg,
        f.days,
        plugin.settings.chatsPath
      );
      new Notice(tr("Report saved: {path}", { path: r.path }));
    } catch (err) {
      console.error("[axxa] salvar report falhou:", err);
      new Notice(
        tr("Could not save the report: {error}", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setSalvando(false);
    }
  };

  const abrir = (c: ChatUsageRow) => {
    void session.load(c);
    onOpenChat();
  };

  const vazio = agg.total.chats === 0;

  return (
    <div className="axxa-chat">
      <header className="axxa-topbar is-bare">
        <button
          type="button"
          className="axxa-icon-btn"
          aria-label={tr("Back")}
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </button>
        <span className="axxa-brand axxa-topbar-brand">{tr("Usage")}</span>
        {/* O relatório é a SAÍDA desta tela, e mora na barra, como o "New"
            das folhas: ele cria uma nota, e no app accent é o que cria.
            Flutuando embaixo, ele cobria justamente a lista que a pessoa
            tinha rolado pra ler. */}
        <button
          type="button"
          className="axxa-topbar-action axxa-topbar-end"
          aria-label={tr("Save this report as a note")}
          title={tr("Save this report as a note")}
          disabled={salvando || vazio}
          onClick={() => void salvarRelatorio()}
        >
          <Icon name={salvando ? "loader" : "file-down"} size={18} />
          <span>{salvando ? tr("Saving…") : tr("Report")}</span>
        </button>
      </header>

      <div className="axxa-messages axxa-home axxa-usage-page">
        {/* O que sobra HOJE vem antes de tudo: é a pergunta do dia a dia
            ("ainda dá pra usar?"), e não depende do período nem dos filtros
            — cota é do dia de cada provider. */}
        <LeftToday plugin={plugin} />

        {/* O período é a régua de tudo o que vem DEPOIS dele — o total, a
            média, os modelos e a lista mudam com ele. */}
        <Segmented
          options={PERIODOS.map((p) => ({ ...p, label: tr(p.label) }))}
          value={String(f.days)}
          label={tr("Period")}
          // Período é UM: duas janelas ao mesmo tempo não querem dizer nada.
          onChange={(id) => setF({ ...f, days: Number(id) })}
        />

        {/* A resposta da pergunta que a pessoa acabou de fazer com o
            recorte. */}
        <section className="axxa-usage is-hero" aria-label={tr("Totals")}>
          <span className="axxa-usage-meta">
            <span className="axxa-usage-big">
              {m === "cost"
                ? formatUsdRounded(agg.total.cost)
                : formatCompact(agg.total.tokensIn + agg.total.tokensOut)}
            </span>
            <span className="axxa-usage-unit">
              {m === "cost" ? tr("spent") : tr("tokens")}
            </span>
            {m === "cost" && agg.total.hasUnknownCost && (
              <span
                className="axxa-usage-approx"
                title={tr("Some models have no public price — this is a floor")}
              >
                +
              </span>
            )}
          </span>
          {/* Quantas conversas, e ONDE elas caíram: "All time" sozinho não
              diz se o total é de um mês ou de dois anos. */}
          <span className="axxa-usage-sub">
            {contagem(agg.total.chats)}
            {!vazio && (
              <>
                <span className="axxa-usage-sep">·</span>
                {faixaDeDatas(agg.periodStart, agg.periodEnd)}
              </>
            )}
          </span>
          <div className="axxa-mods">
            {/* As setas são as do cartão de projeto: o que SOBE sai daqui
                pro modelo, o que DESCE volta dele. */}
            <Modulo
              icone="arrow-up-from-line"
              rotulo={tr("Sent")}
              valor={formatCompact(agg.total.tokensIn)}
              unidade={tr("tokens")}
            />
            <Modulo
              icone="arrow-down-to-line"
              rotulo={tr("Received")}
              valor={formatCompact(agg.total.tokensOut)}
              unidade={tr("tokens")}
            />
            <Modulo
              icone="message-circle"
              rotulo={tr("Per chat")}
              valor={
                media == null
                  ? "—"
                  : m === "cost"
                    ? formatUsdRounded(media)
                    : formatCompact(Math.round(media))
              }
              unidade={m === "cost" ? tr("avg") : tr("tokens")}
            />
          </div>
          {/* O cache de prompt trabalhando: quanto do que foi mandado saiu
              pelo preço de cache, e quanto isso poupou — ou, quando gravar no
              cache custou mais do que ele devolveu (respostas depois de o
              cache expirar), quanto custou a mais. Esconder o prejuízo fazia a
              linha parecer sempre boa notícia. */}
          {agg.total.tokensIn > 0 && (agg.total.tokensCached > 0 || agg.total.economia <= -0.01) && (
            <p className={"axxa-usage-cache" + (agg.total.economia <= -0.01 ? " is-mais-caro" : "")}>
              <Icon name={agg.total.economia <= -0.01 ? "alert-triangle" : "zap"} size={12} />
              <span>
                {agg.total.economia >= 0.01
                  ? tr("{pct}% of what you sent came from the cache — saved {usd}", {
                      pct: Math.round((agg.total.tokensCached / agg.total.tokensIn) * 100),
                      usd: formatUsdRounded(agg.total.economia),
                    })
                  : agg.total.economia <= -0.01
                    ? tr("{pct}% of what you sent came from the cache, but writing to it cost {usd} more than it saved", {
                        pct: Math.round((agg.total.tokensCached / agg.total.tokensIn) * 100),
                        usd: formatUsdRounded(-agg.total.economia),
                      })
                    : tr("{pct}% of what you sent came from the cache", {
                        pct: Math.round((agg.total.tokensCached / agg.total.tokensIn) * 100),
                      })}
              </span>
            </p>
          )}
        </section>

        {/* Os MESMOS dois números do cartão acima, agora ao longo do tempo:
            ele diz quanto, e isto diz quando. Por isso vem colado nele, e não
            no fim da página com as tabelas.
            Com uma coluna só não há série — um gráfico de uma barra é o total
            desenhado de novo, e o total já está logo ali em cima. */}
        {serie.colunas.length > 1 && picoDa(serie.colunas) > 0 ? (
          <GraficoNoTempo colunas={serie.colunas} passo={serie.passo} />
        ) : (
          /* Sem série pra desenhar, o lugar dela NÃO some: a seção vira o
             próprio vazio, com a forma do gráfico apagada atrás e o motivo
             escrito por cima. Sumindo, a página inteira se remonta quando o
             recorte muda, e quem mexeu no filtro não descobre que existe um
             gráfico ali — só vê a tela encurtar. */
          <GraficoVazio
            motivo={
              /* Nenhuma repete o vazio da PÁGINA, que fica logo abaixo e já
                 dá a saída ("Try a longer period or fewer filters"): dizer a
                 mesma frase duas vezes na mesma tela ensina a não ler
                 nenhuma das duas. */
              chats.length === 0
                ? tr("Your tokens land here as you chat.")
                : agg.total.chats === 0
                  ? tr("Nothing to plot yet.")
                  : picoDa(serie.colunas) === 0
                    ? tr("No tokens recorded in these chats.")
                    : tr("Just one day so far — the shape fills in as you go.")
            }
          />
        )}

        {visiveis.length > 0 && (
          <section className="axxa-home-block axxa-usage-filters">
            <div className="axxa-home-headrow">
              <span className="axxa-section-label">{tr("Filter")}</span>
              {/* Limpa os filtros de LISTA; o período fica — ele tem o
                  seletor dele, lá em cima, e não é isto que o botão diz. */}
              {marcados(f) > 0 && (
                <button
                  type="button"
                  className="axxa-home-filter is-accent"
                  onClick={() => setF({ ...FILTRO_VAZIO, days: f.days })}
                >
                  <Icon name="x" size={16} />
                  <span>{tr("Clear")}</span>
                </button>
              )}
            </div>
            {visiveis.map((d) => (
              <div key={d.chave} className="axxa-usage-dim">
                {/* As TRÊS mais usadas à vista; o resto mora na lista do "See
                    all" — o mesmo "See all N ›" da home, na linha do nome. */}
                <div className="axxa-usage-dim-head">
                  <span className="axxa-usage-dim-label">{d.titulo}</span>
                  {d.ops.length > A_VISTA && (
                    <button
                      type="button"
                      className="axxa-home-filter is-accent"
                      onClick={() => verTodos(d.chave)}
                    >
                      <span>{tr("See all {n}", { n: d.ops.length })}</span>
                      <Icon name="chevron-right" size={16} />
                    </button>
                  )}
                </div>
                <div className="axxa-choices" role="group" aria-label={d.titulo}>
                  {opcoesAVista(d.ops, f[d.chave]).map((o) => {
                    const on = f[d.chave].includes(o.id);
                    const nome = d.nome(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={on ? "axxa-choice is-on" : "axxa-choice"}
                        aria-pressed={on}
                        // Lido em voz alta, "GPT 5 13" não diz o que é o 13.
                        aria-label={`${nome}, ${contagem(o.count)}`}
                        onClick={() =>
                          setF({ ...f, [d.chave]: alternar(f[d.chave], o.id) })
                        }
                      >
                        <Icon name={d.icone(o.id)} size={16} />
                        <span>{nome}</span>
                        <sup className="axxa-choice-count" aria-hidden="true">
                          {o.count}
                        </sup>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {vazio ? (
          <div className="axxa-home-empty">
            <Icon name="chart-no-axes-column" size={42} />
            <p>
              {chats.length === 0
                ? tr("No usage yet. Every chat is counted here as you go.")
                : tr("Nothing in this slice. Try a longer period or fewer filters.")}
            </p>
          </div>
        ) : (
          <>
            {/* "O caro é qual?", sem abrir conversa nenhuma. */}
            <section className="axxa-home-block">
              <span className="axxa-section-label">{tr("By model")}</span>
              <div className="axxa-usage-list">
                {modelos.map((r) => (
                  <LinhaDeFatia
                    key={r.id}
                    r={r}
                    m={m}
                    nome={prettyModelName(r.id)}
                    icone={modelLogo(r.id)}
                  />
                ))}
              </div>
            </section>

            <section className="axxa-home-block">
              <span className="axxa-section-label">
                {m === "cost" ? tr("Most expensive chats") : tr("Biggest chats")}
              </span>
              <div className="axxa-usage-list">
                {topo.map((c) => (
                  <LinhaDeConversa
                    key={c.id}
                    c={c}
                    m={m}
                    onOpen={() => abrir(c)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* O "See all" é um RELATÓRIO da dimensão inteira, não um seletor: as
          mesmas linhas do "By model" (o anel da fatia, conversas, tokens,
          valor e %), sem check e sem nada com cara de toque. Filtrar é nas
          pílulas; aqui se lê. */}
      <Sheet
        title={naLista.plural}
        open={listaAberta}
        onClose={() => setListaAberta(false)}
      >
        {naLista.ops.length > BUSCA_A_PARTIR && (
          <SheetSearch
            value={buscaLista}
            placeholder={naLista.busca}
            found={achadas.length}
            onChange={setBuscaLista}
          />
        )}
        <p className="axxa-usage-report-head">
          {escopo.map((parte, i) => (
            <span key={i}>
              {i > 0 && <span className="axxa-usage-sep">·</span>}
              {parte}
            </span>
          ))}
        </p>
        {achadas.length === 0 ? (
          <SheetNote>{tr("Nothing matches that search.")}</SheetNote>
        ) : (
          <div className="axxa-usage-list">
            {relatorio.usadas.map((r) => (
              <LinhaDeFatia
                key={r.id}
                r={r}
                m={mLista}
                nome={naLista.nome(r.id)}
                icone={naLista.icone(r.id)}
              />
            ))}
            {relatorio.paradas.map((o) => (
              <LinhaParada
                key={o.id}
                nome={naLista.nome(o.id)}
                icone={naLista.icone(o.id)}
              />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** "1 chat", "13 chats". */
function contagem(n: number): string {
  return n === 1 ? tr("1 chat") : tr("{n} chats", { n });
}

/**
 * O gráfico de tokens no tempo: uma coluna por dia (ou semana, ou mês), com o
 * que ENTROU embaixo e o que SAIU em cima.
 *
 * Empilhado, e não dois gráficos lado a lado, porque as duas séries são
 * partes da mesma coisa: a coluna inteira é o que aquele dia custou em
 * tokens, e a divisão diz de quem foi. Com duas escalas separadas, a altura
 * de uma não poderia ser comparada com a da outra — e é justamente isso que
 * se quer olhar.
 *
 * As duas cores são a MESMA do app em dois tons, não duas cores diferentes:
 * é uma medida só partida em duas, o acento é escolhido por quem usa (e pode
 * ser qualquer um), e tom claro/escuro é o canal que sobrevive a qualquer
 * daltonismo. Quem diz qual é qual é a legenda, que está sempre lá.
 */
function GraficoNoTempo({
  colunas,
  passo,
}: {
  colunas: Coluna[];
  passo: Passo;
}) {
  /** A coluna que a linha de baixo está lendo. Enquanto ninguém escolhe, é a
   *  mais alta: é ela que define a altura de todas as outras, então é a que
   *  explica o desenho. Chave que não existe mais (o período mudou debaixo da
   *  escolha) volta sozinha pro pico. */
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const pico = picoDa(colunas);
  const alta = colunas.reduce((a, b) => (b.total > a.total ? b : a));
  const alvo = colunas.find((c) => c.inicio === escolhida) ?? alta;

  return (
    <section className="axxa-home-block" aria-label={tr("Tokens over time")}>
      <div className="axxa-home-headrow">
        <span className="axxa-section-label">{tr("Over time")}</span>
        <span className="axxa-chart-step">{tr(PASSO[passo])}</span>
      </div>
      <div className="axxa-chart">
        {/* A legenda existe SEMPRE: dois tons da mesma cor se distinguem, mas
            só ela diz qual dos dois é o quê. */}
        <div className="axxa-chart-legend">
          <span className="axxa-chart-key">
            <span className="axxa-chart-swatch is-in" aria-hidden="true" />
            {tr("Sent")}
          </span>
          <span className="axxa-chart-key">
            <span className="axxa-chart-swatch is-out" aria-hidden="true" />
            {tr("Received")}
          </span>
          {/* O topo da escala. Sem ele, altura é só forma: dá pra comparar as
              colunas entre si e com mais nada. */}
          <span className="axxa-chart-peak">
            {tr("peak {n}", { n: formatCompact(pico) })}
          </span>
        </div>
        <div
          className="axxa-chart-plot"
          role="group"
          aria-label={
            passo === "day"
              ? tr("Tokens per day")
              : passo === "week"
                ? tr("Tokens per week")
                : tr("Tokens per month")
          }
        >
          {colunas.map((c) => (
            <button
              key={c.inicio}
              type="button"
              className={
                c.inicio === alvo.inicio
                  ? "axxa-chart-col is-on"
                  : "axxa-chart-col"
              }
              aria-pressed={c.inicio === alvo.inicio}
              // O mesmo texto da linha de baixo: no computador sai ao passar o
              // mouse, no leitor de tela sai ao chegar na coluna, e no celular
              // o toque leva ele pra linha — o número nunca depende do hover.
              aria-label={tr("{when}: {sent} sent, {received} received", {
                when: c.titulo,
                sent: formatCompact(c.entrada),
                received: formatCompact(c.saida),
              })}
              title={tr("{when} · {sent} sent · {received} received", {
                when: c.titulo,
                sent: formatCompact(c.entrada),
                received: formatCompact(c.saida),
              })}
              onClick={() => setEscolhida(c.inicio)}
            >
              {/* A pilha é separada da coluna porque a coluna é o ALVO DO
                  DEDO (toda a altura, toda a faixa) e a pilha é o desenho —
                  que tem largura de teto pra não virar um bloco gordo quando
                  são poucas. */}
              <span className="axxa-chart-stack">
                <span
                  className="axxa-chart-air"
                  style={{ flexGrow: Math.max(pico - c.total, 0) }}
                />
                {c.saida > 0 && (
                  <span
                    // `has-in` no lugar de um `:has(+ .is-in)` no CSS: quem
                    // sabe se existe barra de entrada é este render, e saber
                    // aqui custa uma comparação em vez de uma invalidação de
                    // seletor no navegador.
                    className={
                      c.entrada > 0
                        ? "axxa-chart-bar is-out has-in"
                        : "axxa-chart-bar is-out"
                    }
                    style={{ flexGrow: c.saida }}
                  />
                )}
                {c.entrada > 0 && (
                  <span
                    className="axxa-chart-bar is-in"
                    style={{ flexGrow: c.entrada }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        {/* As pontas do eixo. Rótulo em toda coluna não caberia, e não é o que
            se lê num gráfico deste tamanho: o que se lê é a forma, e o de
            quando ela começa e termina. */}
        <div className="axxa-chart-axis">
          <span>{colunas[0].rotulo}</span>
          <span>{colunas[colunas.length - 1].rotulo}</span>
        </div>
        <p className="axxa-chart-readout">
          <span className="axxa-chart-when">{alvo.titulo}</span>
          <span className="axxa-usage-sep">·</span>
          {tr("{n} sent", { n: formatCompact(alvo.entrada) })}
          <span className="axxa-usage-sep">·</span>
          {tr("{n} received", { n: formatCompact(alvo.saida) })}
        </p>
      </div>
    </section>
  );
}

/**
 * Uma linha de relatório: o anel da fatia com o logo dentro, o nome, e o
 * valor na ponta. É a do "By model" e a do "See all" de qualquer dimensão.
 *
 * Sem dinheiro na página, o valor vira o volume — e o preço desce pra linha
 * de apoio, onde "free" e "no public price" continuam distintos.
 */
function LinhaDeFatia({
  r,
  m,
  nome,
  icone,
}: {
  r: Fatia;
  m: Metrica;
  /** O nome do APP ("Sonnet 4.6", "OpenAI", "Vault Q&A"). */
  nome: string;
  icone: string;
}) {
  const chats = contagem(r.chats);
  const preco =
    r.preco === "gratis" ? tr("Free") : r.preco === "sem-preco" ? "—" : formatUsd(r.cost);
  return (
    <div className="axxa-usage-row">
      <span
        className="axxa-share"
        style={{ "--axxa-pct": r.pct } as CSSProperties}
        aria-hidden="true"
      >
        <span className="axxa-donut" />
        <Icon name={icone} size={16} />
      </span>
      <span className="axxa-usage-row-text">
        <span className="axxa-usage-row-name">{nome}</span>
        <span className="axxa-usage-row-sub">
          {chats}
          <span className="axxa-usage-sep">·</span>
          {m === "cost"
            ? tr("{n} tokens", { n: formatCompact(r.tokens) })
            : r.preco === "sem-preco"
              ? tr("no public price")
              : tr("free")}
        </span>
      </span>
      <span className="axxa-usage-row-end">
        <span
          className="axxa-usage-row-value"
          title={r.preco === "sem-preco" ? tr("No public price") : undefined}
        >
          {m === "cost" ? preco : formatCompact(r.tokens)}
          {r.piso && <span className="axxa-usage-approx">+</span>}
        </span>
        <span className="axxa-usage-row-pct">
          {r.quase ? "<1%" : `${r.pct}%`}
        </span>
      </span>
    </div>
  );
}

/**
 * As alturas do gráfico FANTASMA — o desenho que ocupa o lugar enquanto não
 * há série.
 *
 * Fixas, e não sorteadas: sorteio muda a cada redesenho e a tela pisca. E
 * irregulares de propósito, sem subir nem descer, pra não se parecer com uma
 * tendência — é uma forma, não um dado.
 */
const FANTASMA = [22, 34, 26, 42, 30, 47, 26, 38, 30, 44, 25, 35];

/**
 * O gráfico quando não há o que desenhar.
 *
 * Ele fica, apagado, em vez de a seção sumir: o lugar do gráfico é parte do
 * que a página ensina, e quem apertou um filtro precisa entender que apagou
 * a série — não que a tela encolheu sozinha.
 *
 * As colunas de mentira ficam no cinza de "não usei" (o mesmo do calendário
 * da home), nunca nas cores das séries: fantasma na cor do dado seria dado
 * inventado.
 */
function GraficoVazio({ motivo }: { motivo: string }) {
  return (
    <section className="axxa-home-block" aria-label={tr("Tokens over time")}>
      <div className="axxa-home-headrow">
        <span className="axxa-section-label">{tr("Over time")}</span>
      </div>
      <div className="axxa-chart is-empty">
        {/* A legenda fica: é ela que diz o que este lugar vai mostrar. */}
        <div className="axxa-chart-legend">
          <span className="axxa-chart-key">
            <span className="axxa-chart-swatch is-in" aria-hidden="true" />
            {tr("Sent")}
          </span>
          <span className="axxa-chart-key">
            <span className="axxa-chart-swatch is-out" aria-hidden="true" />
            {tr("Received")}
          </span>
        </div>
        <div className="axxa-chart-plot">
          {FANTASMA.map((h, i) => (
            <span key={i} className="axxa-chart-col" aria-hidden="true">
              <span className="axxa-chart-stack">
                <span className="axxa-chart-air" style={{ flexGrow: 100 - h }} />
                <span className="axxa-chart-bar is-ghost" style={{ flexGrow: h }} />
              </span>
            </span>
          ))}
          <p className="axxa-chart-motivo">{motivo}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Uma opção SEM conversa no recorte — no relatório mesmo assim, no fim e
 * apagada: "usei esse modelo, só não nesse período" também é informação, e
 * sem ela a lista não bateria com o "See all N" que a abriu.
 */
function LinhaParada({ nome, icone }: { nome: string; icone: string }) {
  return (
    <div className="axxa-usage-row is-idle">
      <span
        className="axxa-share"
        style={{ "--axxa-pct": 0 } as CSSProperties}
        aria-hidden="true"
      >
        <span className="axxa-donut" />
        <Icon name={icone} size={16} />
      </span>
      <span className="axxa-usage-row-text">
        <span className="axxa-usage-row-name">{nome}</span>
        <span className="axxa-usage-row-sub">{tr("No chats in this slice")}</span>
      </span>
      <span className="axxa-usage-row-end">
        <span className="axxa-usage-row-value">—</span>
      </span>
    </div>
  );
}

/**
 * Uma conversa da lista do topo — o mesmo desenho do cartão de conversa da
 * home (logo do provider, título, apoio, a ponta à direita), e abre do mesmo
 * jeito: lista de conversa que não abre a conversa é uma armadilha.
 */
function LinhaDeConversa({
  c,
  m,
  onOpen,
}: {
  c: ChatUsageRow;
  m: Metrica;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="axxa-usage-row" onClick={onOpen}>
      <span className="axxa-card-mark" aria-hidden="true">
        <Icon name={providerIcon(c.provider)} size={20} />
      </span>
      <span className="axxa-usage-row-text">
        <span className="axxa-usage-row-name">{c.title || tr("Untitled")}</span>
        <span className="axxa-usage-row-sub">
          {prettyModelName(c.model)}
          <span className="axxa-usage-sep">·</span>
          {moduleLabel(c.mode)}
        </span>
      </span>
      <span className="axxa-usage-row-end">
        <span className="axxa-usage-row-value">
          {m === "tokens"
            ? formatCompact(c.tokensIn + c.tokensOut)
            : c.cost === 0
              ? tr("Free")
              : formatUsd(c.cost)}
        </span>
        <span className="axxa-usage-row-pct">{relativeShort(c.date)}</span>
      </span>
    </button>
  );
}

/**
 * Um módulo — o do cartão da home, com um ícone no rótulo: aqui os três são
 * parentes (entra, sai, média), e é o desenho que diz qual é qual antes da
 * palavra.
 */
function Modulo({
  icone,
  rotulo,
  valor,
  unidade,
}: {
  icone: string;
  rotulo: string;
  valor: string;
  unidade: string;
}) {
  return (
    <div className="axxa-mod">
      <span className="axxa-mod-title has-icon">
        <Icon name={icone} size={12} />
        <span>{rotulo}</span>
      </span>
      <span className="axxa-mod-row">
        <span className="axxa-mod-value">{valor}</span>
        <span className="axxa-mod-unit">{unidade}</span>
      </span>
    </div>
  );
}
