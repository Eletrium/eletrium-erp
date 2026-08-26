# SUP-H — Bom Controle / fronteira fiscal-financeira

## Papel dos sistemas
- ERP Eletrium: mestre operacional de cliente, material operacional, estoque, projeto, margem e rastreabilidade.
- Bom Controle: sistema satélite fiscal/financeiro.

## Regra de integração
Toda integração passa por adapter próprio. Nenhuma tela ou regra de estoque chama a API fiscal diretamente.

## Contratos previstos
- Cliente aprovado → identificação externa BomControle_ID
- Venda/faturamento → snapshot imutável da versão aprovada
- Fornecedor → vínculo por ID externo, sem usar razão social como chave
- Títulos/NF-e/NFS-e → retorno de status, chaves e liquidação
- Reconciliação → ERP compara estado esperado × retornado e abre exceção quando divergente

## Gate 0 obrigatório antes de chamada produtiva
- chave e ambiente reais homologados;
- schemas reais confirmados;
- licenciamento/recursos necessários confirmados;
- ownership/service account definidos;
- DLP e política de segredo definidas;
- timeout/retry/idempotência definidos;
- rollback/compensação/reconciliação testados.

## Restrições
- retorno fiscal não reescreve estoque histórico;
- liquidação não altera margem histórica da venda;
- produto operacional não precisa virar produto fiscal salvo quando efetivamente vendido/faturado;
- nenhuma dependência do Gate H bloqueia SUP-A..F.

## Homologação
Manter chamadas reais desativadas até que o Gate 0 esteja fechado. Até lá, trabalhar com schemas, adapters e fixtures/mocks versionados.

## Implementação segura

- contrato versionado `bomcontrole-gate0.v1.json` mantém `productionEnabled=false`;
- adapter exige credencial por provider de runtime, nunca valor persistido;
- operações são validadas antes do transporte;
- timeout após envio produz `PENDING_RECONCILIATION` e proíbe retry cego;
- fixtures e testes usam somente transporte simulado;
- checklist de evidências está em `SUP-H-GATE0-CHECKLIST.md`.

Nenhuma chamada real ao Bom Controle foi executada.
