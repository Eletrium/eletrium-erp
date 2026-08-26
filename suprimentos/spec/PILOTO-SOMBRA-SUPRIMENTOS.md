# Piloto-sombra Suprimentos — A a F

## Escopo validado

Branch efêmera derivada de `active-suprimentos-v1.2.1-20260824`, composta apenas pelos
deltas das frentes SUP-A a SUP-F. Nenhum arquivo de interface, CRM ou OS participa do
ensaio.

Fluxo executado:

`Proposta_ID → Projeto_ID → Pacote_ID → Necessidade_ID → Solicitação de Compra → Cotação
→ Aprovação → Pedido → Recebimento → Staging NF-e → Matching → Entrada no ledger →
Projeção de estoque → resolução da exceção`

## Resultado

- todas as suítes unitárias de SUP-A a SUP-F verdes;
- runner único com 10/10 suítes verdes, incluindo adapters, falhas e schema físico;
- teste integrado `tests/suprimentos-integration-shadow.test.js` verde;
- `Item_ID` preservado entre cotação, pedido e recebimento;
- entrada aceita contém correlação, idempotência, versão documental e identidade do item;
- movimento de entrada é consumido diretamente pela reconstrução do ledger;
- exceção de falta é encerrada somente por evento com evidência do recebimento;
- nenhum arquivo protegido foi alterado.

## Limites conscientes

- persistência ainda usa implementações puras/em memória; adapter SharePoint/ETag precisa
  de homologação própria antes do piloto com dados reais;
- não há chamada a Bom Controle, Financeiro, CRM ou OS;
- `OS_ID` permanece referência externa opcional;
- não há integração com `suprimentos.html`;
- Gate H continua bloqueado até o Gate 0 de homologação.

Este piloto prova compatibilidade de contratos e regras, não autoriza publicação nem uso
produtivo.
