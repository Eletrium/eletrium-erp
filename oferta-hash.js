/* ==========================================================================
   OFERTA VERSIONADA COM HASH — congelar escopo+tarifa e invalidar o aceite
   quando qualquer um dos dois muda.  (item 5)

   O QUE ESTÁ VERSIONADO AQUI: a PROPOSTA COMERCIAL AO CLIENTE (lista
   `Propostas` + itens em `ItensPropostas`). É a oferta com exposição
   contratual externa: o cliente aceita um escopo por um preço.
   A oferta de ALOCAÇÃO AO PARCEIRO MEI (OS_Alocacoes_Parceiros /
   portal-alocacao.html) NÃO é tratada aqui — ver "ALTERNATIVA REJEITADA"
   no relatório. Este módulo é list-agnostic de propósito (recebe campos,
   itens e tarifa como parâmetros), então estender para ela depois não
   exige redesenho.

   --------------------------------------------------------------------------
   REGRA CENTRAL (literal, é isto que o código implementa)

     O aceite vale para UM hash específico.
     Um aceite é VÁLIDO se, e somente se, Hash_Aceito === Oferta_Hash_Vigente.
     Se escopo ou tarifa mudar, a nova versão congelada tem outro hash; o
     aceite anterior deixa de casar e passa a INVALIDADO — mas permanece
     no ledger, íntegro. "Fulano aceitou a versão X em tal data" é fato
     que aconteceu e não se apaga.

   INVALIDAÇÃO É DERIVADA, NUNCA GRAVADA — e isso é deliberado.
     Não existe campo "aceite_invalidado". A validade é sempre recalculada
     comparando hashes. Um flag gravado ficaria DESATUALIZADO exatamente no
     cenário que mais importa: alguém que escreve direto no Graph muda o
     escopo sem passar pela tela e o flag continuaria dizendo "válido".
     A comparação derivada continua correta mesmo nesse caso, porque ela
     relê o conteúdo e recomputa. Ver LIMITAÇÃO DECLARADA abaixo.

   --------------------------------------------------------------------------
   O HASH É FUNÇÃO DO CONTEÚDO E DE MAIS NADA — divergência deliberada do B7.

     O snapshot B7 de os.html inclui `timestamp: agora` no manifesto, porque
     lá o que se congela é um EVENTO (o fechamento da OS naquele instante).
     Aqui é o oposto: o manifesto não pode conter relógio, id de execução,
     nem nada volátil, senão "mesmo escopo+tarifa ⇒ mesmo hash" seria falso
     e a regra de invalidação inteira desabaria (todo recálculo daria
     diferente e todo aceite pareceria inválido).
     Quando/quem congelou fica nos CAMPOS da versão (Congelada_Em /
     Congelada_Por), fora do texto hasheado.

   O QUE ENTRA NO HASH (escopo e tarifa — o que o cliente aceita):
     escopo ....... Descricao, Tipo_Servico_Proposta, PrazoExecucao,
                    FormaPagamento, e as linhas de ItensPropostas
     tarifa/preço . Valor_Servico, Valor_Materiais, ValorTotal, DataValidade
                    e a VERSÃO DE TARIFA vigente (B5) com seus valores

   O QUE NÃO ENTRA, E POR QUÊ:
     Status, Etapa_Pipeline, Data_Entrada_Etapa, SLA_*, Responsavel_Principal,
     Proxima_Acao, Data_Proxima_Acao, Motivo_Perda, Concorrente, Observacoes,
     Probabilidade_Fechamento.
     Nada disso é termo ofertado ao cliente. Mover a proposta no pipeline,
     trocar o responsável ou anotar uma observação interna NÃO pode invalidar
     um aceite — seria alarme falso, e alarme falso ensina a ignorar alarme.

   --------------------------------------------------------------------------
   LIMITAÇÃO DECLARADA (sem gateway B1)
     A invalidação é CLIENT-SIDE. Quem escrever direto no Microsoft Graph
     (Make, Power Automate, script, portal do SharePoint) muda Descricao ou
     Valor_Servico sem passar por esta regra: nenhuma versão nova é congelada
     e nenhum aviso é emitido no momento da escrita.
     O que esta camada garante mesmo assim: na PRÓXIMA vez que a tela abrir a
     proposta, o hash é recomputado sobre o conteúdo relido e a divergência
     aparece. Detecção posterior, não prevenção. Só o gateway B1 (escrita
     server-side obrigatória) fecha isso.
   ========================================================================== */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api; // node (asserções)
  else raiz.OFERTA = api;                                                 // navegador
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LISTA_VERSOES = "Propostas_Ofertas_Versoes";
  var LISTA_ACEITES = "Propostas_Aceites";

  /* ---------- normalizações (determinismo do manifesto) ------------------ */

  // Texto: NFC, CRLF->LF, sem espaço à direita de cada linha, trim nas pontas.
  // "" e só-espaços viram null — o repo nunca trata "" como valor.
  function txt(v) {
    if (v == null) return null;
    var s = String(v).normalize("NFC").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
    return s === "" ? null : s;
  }
  // Dinheiro: sempre 2 casas. 4980, "4980.0" e 4980.004 colapsam em "4980.00",
  // senão o mesmo preço relido do Graph poderia gerar hash diferente.
  function moeda(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n.toFixed(2) : null;
  }
  // Número livre (quantidade, horas, alíquota): forma canônica do próprio JS.
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? String(n) : null;
  }
  // Data: só a parte AAAA-MM-DD. DataValidade é Date only; comparar o ISO
  // inteiro faria o hash depender do fuso de quem gravou.
  function dia(v) {
    var s = txt(v);
    return s ? s.slice(0, 10) : null;
  }

  /* ---------- manifesto canônico (forma do B7, os.html) ------------------ */

  // Chaves em ordem alfabética, JSON determinístico: o MESMO objeto sempre
  // produz o MESMO texto e portanto o mesmo SHA-256. Ordenação RASA — igual
  // ao precedente; por isso os itens entram já pré-serializados em `escopo_itens`.
  function manifestoCanonico(obj) {
    return JSON.stringify(
      Object.keys(obj).sort().reduce(function (a, k) { a[k] = obj[k]; return a; }, {}));
  }

  // SHA-256 hex via WebCrypto. Exige contexto seguro (https ou localhost) no
  // navegador; em node, crypto.subtle é global desde a 18.
  async function sha256Hex(txtEntrada) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(txtEntrada)));
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  /* ---------- itens do escopo (ItensPropostas) --------------------------- */

  // ItensPropostas carrega DOIS pares de campos de valor, herança de schema:
  // ValorUnitario/Valor_Unitario e ValorTotal/Valor_Total_Item. Lemos os dois
  // com precedência para o nome novo — ignorar um deles produziria hash cego
  // a uma mudança de preço gravada no outro.
  function itemCanonico(it) {
    var f = (it && it.fields) || it || {};
    return manifestoCanonico({
      codigo:         txt(f.Codigo_Item),
      descricao:      txt(f.Title),
      unidade:        txt(f.Unidade),
      tipo:           txt(f.Tipo_Item),
      quantidade:     num(f.Quantidade),
      horas:          num(f.Horas_Previstas),
      valor_unitario: moeda(f.Valor_Unitario != null ? f.Valor_Unitario : f.ValorUnitario),
      valor_total:    moeda(f.Valor_Total_Item != null ? f.Valor_Total_Item : f.ValorTotal)
    });
  }

  // A ordem que o Graph devolve NÃO é garantida — ordenamos as linhas já
  // serializadas, então a mesma lista de itens em qualquer ordem dá o mesmo
  // texto. Linhas idênticas duplicadas continuam ambas presentes (duplicata
  // é conteúdo, não ruído: 2x o mesmo item custa o dobro).
  function itensCanonico(itens) {
    var linhas = (itens || []).map(itemCanonico);
    linhas.sort();
    return "[" + linhas.join(",") + "]";
  }

  /* ---------- tarifa vigente (regra B5, replicada) ----------------------- */

  // Chave de competência AAAA-MM. Data pura ("...T00:00:00Z") é fatiada do
  // ISO em vez de convertida — new Date() local mostraria o mês anterior
  // no dia 1º em Brasília.
  function mKey(s) {
    if (!s) return null;
    var str = String(s);
    if (/^\d{4}-\d{2}/.test(str)) return str.slice(0, 7);
    var d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  // PURA. Mesma regra de tarifaVigente() em medicao.html (B5):
  //   Ativa === true; Vigencia_Inicio <= competência; sem Vigencia_Fim =
  //   vigência aberta; sobreposição desempata pela Vigencia_Inicio mais recente.
  function tarifaVigenteEm(tarifas, ym) {
    if (!ym || !Array.isArray(tarifas)) return null;
    var cand = tarifas.filter(function (t) {
      var f = (t && t.fields) || t || {};
      if (f.Ativa !== true) return false;
      var ini = mKey(f.Vigencia_Inicio);
      if (!ini || ini > ym) return false;
      var fim = mKey(f.Vigencia_Fim);
      if (fim && fim < ym) return false;
      return true;
    });
    if (!cand.length) return null;
    cand.sort(function (a, b) {
      return String(mKey(((b && b.fields) || b || {}).Vigencia_Inicio) || "")
        .localeCompare(String(mKey(((a && a.fields) || a || {}).Vigencia_Inicio) || ""));
    });
    return cand[0];
  }

  // Competência da oferta = a da DataEmissao.
  // SEM DataEmissao NÃO se resolve tarifa — e isso é de propósito. Cair para
  // "hoje" faria o hash mudar sozinho na virada do mês, sem ninguém ter
  // tocado em escopo nem em preço, e todo aceite seria invalidado por engano.
  // O hash só pode depender de conteúdo GRAVADO.
  function competenciaDaOferta(fields) {
    return mKey((fields || {}).DataEmissao);
  }

  function refTarifa(tarifa) {
    if (!tarifa) return null;
    var f = (tarifa.fields) || tarifa || {};
    return "#" + (tarifa.id != null ? tarifa.id : "?") + " " + (txt(f.Title) || "(sem titulo)");
  }

  /* ---------- o manifesto da oferta ------------------------------------- */

  /**
   * Texto canônico da oferta. PURA — não faz rede, não lê relógio.
   * @param {object} e { propostaId, fields, itens, tarifas }
   *        fields  = campos da Propostas (expandidos)
   *        itens   = linhas de ItensPropostas desta proposta
   *        tarifas = itens de Tarifas_Versoes (resolvemos a vigente aqui)
   * @returns {{manifesto:string, tarifa:object|null, competencia:string|null, tarifaRef:string|null}}
   */
  function manifestoOferta(e) {
    var f = (e && e.fields) || {};
    var comp = competenciaDaOferta(f);
    var tarifa = comp ? tarifaVigenteEm(e && e.tarifas, comp) : null;
    var tf = (tarifa && (tarifa.fields || tarifa)) || {};

    var manifesto = manifestoCanonico({
      // identidade
      proposta_id:              e && e.propostaId != null ? String(e.propostaId) : null,
      // ----- escopo -----
      escopo_descricao:         txt(f.Descricao),
      escopo_tipo_servico:      txt(f.Tipo_Servico_Proposta),
      escopo_prazo_execucao:    txt(f.PrazoExecucao),
      escopo_forma_pagamento:   txt(f.FormaPagamento),
      escopo_itens:             itensCanonico(e && e.itens),
      // ----- tarifa / preço -----
      tarifa_valor_servico:     moeda(f.Valor_Servico),
      tarifa_valor_materiais:   moeda(f.Valor_Materiais),
      tarifa_valor_total:       moeda(f.ValorTotal),
      tarifa_data_validade:     dia(f.DataValidade),
      // ----- versão de tarifa que valia (B5) -----
      // Sem competência (proposta sem DataEmissao) a tarifa NÃO é resolvida e
      // isso fica dito no manifesto, em vez de fingir que não havia tarifa.
      tarifa_competencia:       comp,
      tarifa_versao_ref:        comp ? (refTarifa(tarifa) || "(nenhuma versao vigente na competencia)")
                                     : "(sem data de emissao: tarifa nao resolvida)",
      tarifa_valor_hora:        moeda(tf.Valor_Hora_Padrao),
      tarifa_aliquota_iss:      num(tf.Aliquota_ISS_Pct),
      tarifa_aliquota_inss:     num(tf.Aliquota_INSS_Pct),
      tarifa_aliquota_irrf:     num(tf.Aliquota_IRRF_Pct)
    });

    return {
      manifesto: manifesto,
      tarifa: tarifa,
      competencia: comp,
      tarifaRef: comp ? (refTarifa(tarifa) || "(nenhuma versao vigente na competencia)")
                      : "(sem data de emissao: tarifa nao resolvida)"
    };
  }

  /** Manifesto + hash numa chamada. */
  async function hashOferta(e) {
    var m = manifestoOferta(e);
    m.hash = await sha256Hex(m.manifesto);
    return m;
  }

  /* ---------- chaves de idempotência (unicidade server-side) ------------- */

  // Precedente: OS_Documentos_Versoes.Chave_Versao = "<docId>|v<n>".
  var chaveVersao = function (propostaId, n) { return String(propostaId) + "|v" + String(n); };
  // O aceite é único por (proposta, hash aceito): registrar duas vezes o
  // mesmo aceite do mesmo conteúdo é a MESMA coisa, e o servidor recusa.
  // Aceitar de novo DEPOIS de uma mudança gera outro hash -> outra chave -> passa.
  var chaveAceite = function (propostaId, hash) { return String(propostaId) + "|" + String(hash); };

  // Colisão de chave única no SharePoint. Mesma detecção de documentos-os.html.
  function ehColisaoChave(e) {
    return !!e && (e.status === 400 || e.status === 409) &&
      /duplicate|duplicad/i.test(String(e.message || "") + String(e.corpo || ""));
  }

  /* ---------- leitura do ledger ----------------------------------------- */

  var idDaProposta = function (linha) {
    var f = (linha && linha.fields) || {};
    return f.PropostaLookupId != null ? String(f.PropostaLookupId) : null;
  };

  function versoesDaProposta(versoes, propostaId) {
    return (versoes || []).filter(function (v) { return idDaProposta(v) === String(propostaId); })
      .sort(function (a, b) {
        return Number(((b.fields) || {}).Numero_Versao || 0) - Number(((a.fields) || {}).Numero_Versao || 0);
      });
  }
  function aceitesDaProposta(aceites, propostaId) {
    return (aceites || []).filter(function (a) { return idDaProposta(a) === String(propostaId); })
      .sort(function (a, b) {
        return String(((b.fields) || {}).Aceito_Em || "").localeCompare(String(((a.fields) || {}).Aceito_Em || ""));
      });
  }
  function proximaVersao(versoes, propostaId) {
    var lista = versoesDaProposta(versoes, propostaId);
    var max = 0;
    lista.forEach(function (v) {
      var n = Number(((v.fields) || {}).Numero_Versao || 0);
      if (isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  /* ---------- AVALIAÇÃO: onde a regra central vive ----------------------- */

  // Proposta "fechada" sem hash nenhum = aceite legado, anterior a este
  // mecanismo. O repo trata legado de forma RESTRITIVA: não se assume válido.
  var ETAPAS_FECHADAS = ["Ganho"];
  var STATUS_FECHADOS = ["Aprovada"];

  /**
   * Situação da oferta e do aceite. PURA — toda a decisão em um lugar só,
   * testável sem rede e sem DOM.
   *
   * @param {object} e { propostaId, fields, hashAtual, versoes, aceites }
   *        hashAtual = hash RECOMPUTADO agora sobre o conteúdo relido
   * @returns {object} situacao + flags + textos
   */
  function avaliarOferta(e) {
    var f = (e && e.fields) || {};
    var propostaId = e && e.propostaId;
    var hashAtual = (e && e.hashAtual) || null;

    var hashVigente = txt(f.Oferta_Hash_Vigente);
    var versaoVigente = f.Oferta_Versao_Vigente == null ? null : Number(f.Oferta_Versao_Vigente);

    var minhasVersoes = versoesDaProposta(e && e.versoes, propostaId);
    var meusAceites = aceitesDaProposta(e && e.aceites, propostaId);
    var ultimoAceite = meusAceites.length ? meusAceites[0] : null;
    var hashAceito = ultimoAceite ? txt((ultimoAceite.fields || {}).Hash_Aceito) : null;

    // Verificação por releitura, no espírito do B7: o ponteiro em Propostas
    // tem de casar com uma linha REAL do ledger. Se não casa, o ledger manda
    // e a tela denuncia — nada é corrigido em silêncio.
    var linhaVigente = null;
    minhasVersoes.forEach(function (v) {
      if (txt((v.fields || {}).Hash_SHA256) === hashVigente && hashVigente) linhaVigente = v;
    });
    var ponteiroForaDoLedger = !!hashVigente && !linhaVigente;

    var fechada = ETAPAS_FECHADAS.indexOf(f.Etapa_Pipeline) > -1 ||
                  STATUS_FECHADOS.indexOf(f.Status) > -1;

    // Há mudança de conteúdo desde o congelamento? (escopo ou tarifa)
    var mudouDesdeCongelamento = !!hashVigente && !!hashAtual && hashAtual !== hashVigente;

    // ---- A REGRA, literal ----
    var aceiteValido = !!hashAceito && !!hashVigente && hashAceito === hashVigente;
    var aceiteInvalidado = !!hashAceito && !aceiteValido;

    var situacao, titulo, detalhe, cor;

    if (!hashVigente && !minhasVersoes.length) {
      if (fechada) {
        // legado: fechada sem NENHUM registro verificável do que foi acordado
        situacao = "LEGADO_SEM_HASH";
        cor = "amarelo";
        titulo = "Proposta fechada sem oferta versionada";
        detalhe = "Esta proposta está como " + (txt(f.Status) || txt(f.Etapa_Pipeline) || "fechada") +
          ", mas não existe nenhuma versão congelada nem registro de aceite com hash. " +
          "O que foi acordado não é verificável por este sistema. Não se assume válido: " +
          "congele a versão vigente e registre o aceite para passar a haver prova.";
      } else {
        situacao = "SEM_OFERTA";
        cor = "azul";
        titulo = "Oferta ainda não congelada";
        detalhe = "Nenhuma versão da oferta foi congelada. Enquanto isso, escopo e tarifa " +
          "podem mudar livremente e não há nada para o cliente aceitar.";
      }
    } else if (ponteiroForaDoLedger) {
      situacao = "PONTEIRO_QUEBRADO";
      cor = "amarelo";
      titulo = "Ponteiro de vigência quebrado";
      detalhe = "Propostas.Oferta_Hash_Vigente aponta para um hash que NÃO existe no " +
        "histórico desta proposta. O ledger é a fonte de verdade — confira o histórico abaixo. " +
        "Nada foi corrigido automaticamente.";
    } else if (aceiteInvalidado) {
      situacao = "ACEITE_INVALIDADO";
      cor = "amarelo";
      titulo = "Aceite invalidado — escopo ou tarifa mudou";
      detalhe = "O aceite registrado é da v" +
        ((ultimoAceite.fields || {}).Versao_Aceita != null ? (ultimoAceite.fields || {}).Versao_Aceita : "?") +
        " (hash " + String(hashAceito).slice(0, 12) + "…), mas a oferta vigente é a v" +
        (versaoVigente != null ? versaoVigente : "?") + " (hash " + String(hashVigente).slice(0, 12) + "…). " +
        "Escopo ou tarifa mudou depois do aceite, então o aceite anterior NÃO cobre a oferta atual. " +
        "É preciso um novo aceite sobre a versão vigente. O aceite anterior continua no histórico — não foi apagado.";
    } else if (aceiteValido && mudouDesdeCongelamento) {
      situacao = "ACEITE_VALIDO_COM_RASCUNHO";
      cor = "azul";
      titulo = "Aceite válido — há alterações ainda não congeladas";
      detalhe = "O cliente aceitou a v" + (versaoVigente != null ? versaoVigente : "?") +
        ", que continua sendo a que vale. O conteúdo atual da proposta já difere dessa versão, " +
        "mas essas alterações ainda NÃO foram congeladas e não valem para o cliente. " +
        "Congelar uma nova versão vai invalidar o aceite atual.";
    } else if (aceiteValido) {
      situacao = "ACEITE_VALIDO";
      cor = "verde";
      titulo = "Aceite válido para a oferta vigente";
      detalhe = "O hash aceito é exatamente o hash da v" + (versaoVigente != null ? versaoVigente : "?") +
        " vigente, e o conteúdo atual confere com ela.";
    } else if (mudouDesdeCongelamento) {
      situacao = "CONGELADA_DESATUALIZADA";
      cor = "azul";
      titulo = "Há alterações não congeladas";
      detalhe = "A v" + (versaoVigente != null ? versaoVigente : "?") + " é a que vale para o cliente. " +
        "O conteúdo atual da proposta já mudou em relação a ela — congele uma nova versão " +
        "para que a mudança passe a valer. Isto é informação, não defeito.";
    } else {
      situacao = "CONGELADA_SEM_ACEITE";
      cor = "azul";
      titulo = "Oferta congelada, sem aceite registrado";
      detalhe = "A v" + (versaoVigente != null ? versaoVigente : "?") +
        " está congelada e confere com o conteúdo atual, mas ninguém registrou aceite dela ainda.";
    }

    return {
      situacao: situacao,
      cor: cor,                  // azul informa | amarelo denuncia | verde confirma
      titulo: titulo,
      detalhe: detalhe,
      hashAtual: hashAtual,
      hashVigente: hashVigente,
      hashAceito: hashAceito,
      versaoVigente: versaoVigente,
      proximaVersao: proximaVersao(e && e.versoes, propostaId),
      aceiteValido: aceiteValido,
      aceiteInvalidado: aceiteInvalidado,
      mudouDesdeCongelamento: mudouDesdeCongelamento,
      ponteiroForaDoLedger: ponteiroForaDoLedger,
      legado: situacao === "LEGADO_SEM_HASH",
      versoes: minhasVersoes,
      aceites: meusAceites,
      ultimoAceite: ultimoAceite,
      // Congelar é sempre permitido (é o que conserta tudo). Registrar aceite
      // exige uma versão vigente: sem hash congelado não há o que aceitar.
      podeCongelar: true,
      podeAceitar: !!hashVigente && !ponteiroForaDoLedger,
      motivoNaoAceitar: !hashVigente
        ? "Não há versão congelada da oferta — congele uma versão antes de registrar o aceite."
        : (ponteiroForaDoLedger
            ? "O ponteiro de vigência não bate com o histórico — resolva a divergência antes de registrar aceite."
            : null)
    };
  }

  return {
    LISTA_VERSOES: LISTA_VERSOES,
    LISTA_ACEITES: LISTA_ACEITES,
    txt: txt, moeda: moeda, num: num, dia: dia, mKey: mKey,
    manifestoCanonico: manifestoCanonico,
    sha256Hex: sha256Hex,
    itemCanonico: itemCanonico,
    itensCanonico: itensCanonico,
    tarifaVigenteEm: tarifaVigenteEm,
    competenciaDaOferta: competenciaDaOferta,
    manifestoOferta: manifestoOferta,
    hashOferta: hashOferta,
    chaveVersao: chaveVersao,
    chaveAceite: chaveAceite,
    ehColisaoChave: ehColisaoChave,
    versoesDaProposta: versoesDaProposta,
    aceitesDaProposta: aceitesDaProposta,
    proximaVersao: proximaVersao,
    avaliarOferta: avaliarOferta
  };
});
