# Eletrium ERP — Suprimentos / Materiais / Estoque / Projetos

## Linha ativa de implementação

- Branch: `active-suprimentos-v1.2.1-20260824`
- Base: `master@1c80e626d349489e7f06148ad74fb8f86722d68c`
- Documento normativo: `Roadmap_Suprimentos_Materiais_Estoque_e_Projetos_Eletrium_v1.2.1.docx` (03/08/2026)
- Estado: construção paralela; **não é fonte oficial nem está liberado para produção**.

## Delta factual Roadmap × master 10/08

O Roadmap v1.2.1 descrevia `suprimentos.html` como em desenvolvimento e sem reserva transacional homologada. O `master` avançou depois disso e já contém tentativa de reserva pré-status com ETag/rollback, solicitações de compra e cotações.

Isso NÃO fecha o P0 de estoque porque o Roadmap exige explicitamente:

1. `Reservas_Estoque` como ledger por documento/versão/item/chave única;
2. `Movimentacoes_Estoque` como ledger imutável de entrada/saída/ajuste/devolução/transferência;
3. disponibilidade derivada de físico menos reservas válidas;
4. falha multiproduto sem falso estado de atendimento completo;
5. compensação rastreável em falha parcial — nunca apagar trilha;
6. campos agregados de `Produtos` apenas como projeção reconciliável.

Portanto, o mecanismo atual que atualiza diretamente `Produtos.Estoque_Reservado` é **legado de transição** e não pode virar a arquitetura oficial.

## Princípios não negociáveis

- Ledger antes do KPI.
- Snapshot/versionamento antes de pedido, reserva ou emissão.
- Idempotência por comando/documento/versão/item.
- Concorrência otimista com ETag/If-Match ou serialização equivalente.
- Nenhuma gravação crítica depois de alterar somente um status visual.
- Sem falha silenciosa ou KPI parcial.
- Material `ELETRIUM`, `CLIENTE` e `MISTA` preservam propriedade/custo/responsabilidade separados.
- IDs são relacionais; nunca usar descrição/razão social como vínculo.
- Parâmetros e alçadas versionados, não hardcoded.
- Bom Controle permanece fronteira fiscal/financeira; ERP é mestre operacional.

## Frentes paralelas

### SUP-A — Dados, schema e contratos (Gate A)

Escopo P0:
- inventariar listas SharePoint atuais e internas names;
- mapear/criar contratos para `Necessidades_Materiais`, `Reservas_Estoque`, `Movimentacoes_Estoque`, `Estoque_Projetado` e `Eventos_Integracao`;
- chaves únicas, IDs, Row_Version, Idempotency_Key e permissões;
- leitura paginada e erro visível.

Gate:
- schema factual documentado;
- nenhuma escrita ativada em lista inexistente/incompatível;
- testes SUP-DAT-001..005.

### SUP-B — Reserva e ledger de estoque (Gate B)

Escopo P0:
- algoritmo transacional de reserva;
- pré-validação do conjunto antes de qualquer efeito;
- ledger de reservas;
- movimentos imutáveis;
- disponibilidade derivada;
- ETag/If-Match;
- parcial/falta explícita;
- cancelamento/liberação/consumo por evento compensatório.

Gate:
- TS-11..15 + TS-56 verdes;
- concorrência do último saldo sem venda dupla;
- reprocessamento não duplica.

### SUP-C — Projeto/EAP/OS/Material (Gate C)

Escopo P0:
- `Proposta_ID → Projeto_ID → EAP/Pacote → OS_ID → Necessidade_ID`;
- baseline/snapshot de materiais;
- data necessária e criticidade;
- origem `ELETRIUM` / `CLIENTE` / `MISTA`;
- falta vira solicitação de compra vinculada.

Gate:
- TS-18..21 verdes;
- nenhum material comprado sem rastreabilidade de projeto/item.

### SUP-D — Compras (Gate D)

Escopo P0:
- normalizar `Solicitacoes_Compra` em cabeçalho + itens;
- cotação versionada e rodada;
- mapa comparativo;
- aprovação/alçada;
- pedido de compra versionado;
- follow-up e exceções.

Gate:
- cadeia requisição → cotação → pedido → confirmação íntegra;
- TS-33..40 verdes.

### SUP-E — Recebimento, NF-e e reconciliação (Gate E)

Escopo P0:
- recebimento físico cabeçalho + itens;
- NF-e em staging;
- matching Pedido × Recebido × NF-e;
- entrada no estoque/custo somente após aceite;
- divergência/quantidade rejeitada/evidência;
- chave NF-e única.

Gate:
- TS-41+ correspondentes verdes;
- NF-e sem pedido não movimenta estoque.

### SUP-F — Operação / caixa de trabalho (Gate F)

- painel por exceção;
- erros persistentes, correlação e reprocessamento;
- documentos editáveis/versionados;
- indicadores derivados dos ledgers.

### SUP-H — Bom Controle (Gate H)

Pode evoluir em paralelo apenas em contrato/homologação. Nenhuma chamada produtiva até fechar Gate 0 da integração: chave/ambiente, licenciamento Premium quando aplicável, DLP, service account/ownership, schemas reais e rollback/reconciliação.

## Ordem de integração

1. SUP-A + núcleo puro SUP-B.
2. SUP-B persistente em sandbox/SharePoint homologado.
3. SUP-C e SUP-D em paralelo sobre contratos estáveis.
4. SUP-E.
5. SUP-F.
6. piloto-sombra dos três cenários do Roadmap.
7. Gate H fiscal/financeiro quando ambiente real estiver homologado.

## Regra de branches

Cada frente trabalha em branch própria a partir desta branch ativa e abre PR draft contra `active-suprimentos-v1.2.1-20260824`. Nunca direto em `master`.
