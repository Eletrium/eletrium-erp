# Matriz de composição dos PRs de Suprimentos

Todos os PRs permanecem draft e baseados em `active-suprimentos-v1.2.1-20260824`.
Nenhum deles deve ser mesclado em `master` por esta trilha.

| PR | Frente | Entrada permitida | Saída | Dependência direta |
|---|---|---|---|---|
| #11 | SUP-A | linha ativa | contratos e schema | nenhuma |
| #12 | SUP-B | linha ativa | ledger, adapters e reconciliação | contrato A |
| #13 | SUP-C | linha ativa | necessidade Projeto/EAP | IDs de A |
| #14 | SUP-D | linha ativa | cotação, aprovação, pedido | IDs de A/C |
| #15 | SUP-E | linha ativa | recebimento, NF-e, entrada | IDs de D |
| #16 | SUP-F | linha ativa | exceções append-only | eventos A-E |
| #17 | SUP-H | linha ativa | adapter bloqueado por Gate 0 | nenhuma para A-F |
| #18 | SUP-G | composição A-F | ensaio integrado | validação somente |

O PR #18 é uma branch composta para teste e piloto-sombra. Não é atalho de merge e não
substitui a revisão dos PRs #11–#16. A ordem recomendada de composição após homologação
é A, B, C, D, E, F; em cada passo, reexecutar `node tests/run-suprimentos.js`.

Arquivos proibidos na composição: `inbound.html`, `reaquecimento.html`, `os.html`,
`outbox.js` e qualquer máquina de estados da trilha OS. `suprimentos.html` só recebe o
delta depois da revisão de conflito documentada.
