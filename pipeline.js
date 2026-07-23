// pipeline.js — metadados de apresentação das etapas do pipeline.
//
// FONTE DA VERDADE dos NOMES/ORDEM = a coluna Etapa_Pipeline no SharePoint (lida via Graph).
// Este objeto guarda só a APRESENTAÇÃO (cor / ícone / SLA), que não existe no SharePoint.
// As chaves DEVEM bater exatamente com os choices reais (com acento). A função
// validateEtapasConfig() confere isso no carregamento e avisa na tela se divergir —
// é a trava contra a causa-raiz do bug antigo do Kanban ("Qualificacao" != "Qualificação").

window.ETAPA_CONFIG = {
  "Lead Novo":          { cor: "#58A6FF", icone: "Novo",    sla_h: 24  },
  "Qualificação":       { cor: "#A371F7", icone: "Qualif",  sla_h: 48  },
  "Em Elaboração":      { cor: "#F0883E", icone: "Elab",    sla_h: 72  },
  "Enviada":            { cor: "#1ABFBF", icone: "Env",     sla_h: 168 },
  "Em Negociação":      { cor: "#F0883E", icone: "Neg",     sla_h: 96  },
  "Aguardando Decisão": { cor: "#8B949E", icone: "Aguard",  sla_h: 120 },
  "Ganho":              { cor: "#22B573", icone: "Ganho",   sla_h: 0   },
  "Perdido":            { cor: "#F85149", icone: "Perdido", sla_h: 0   }
};

// Cor de fallback para etapa sem config (aparece, mas em cinza neutro).
window.ETAPA_COR_FALLBACK = "#6E7681";

// Compara as chaves de ETAPA_CONFIG com os choices reais vindos do SharePoint.
// Retorna { ok, semConfig, semChoice } onde:
//   semConfig  = choices do SharePoint que NÃO têm entrada em ETAPA_CONFIG (coluna apareceria sem cor)
//   semChoice  = chaves de ETAPA_CONFIG que NÃO existem como choice (typo/acento — o bug antigo)
window.validateEtapasConfig = function (choices) {
  const cfgKeys = Object.keys(window.ETAPA_CONFIG);
  const semConfig = (choices || []).filter(c => !window.ETAPA_CONFIG[c]);
  const semChoice = cfgKeys.filter(k => !(choices || []).includes(k));
  return { ok: semConfig.length === 0 && semChoice.length === 0, semConfig, semChoice };
};

window.etapaCor = function (etapa) {
  const e = window.ETAPA_CONFIG[etapa];
  return e ? e.cor : window.ETAPA_COR_FALLBACK;
};
