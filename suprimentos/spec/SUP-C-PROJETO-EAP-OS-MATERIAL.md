# SUP-C — Projeto / EAP / OS / Material

## Cadeia canônica
`Proposta_ID → Projeto_ID → EAP_ID/Pacote_ID → OS_ID → Necessidade_ID`

## Regra de domínio
- Projeto é dono da necessidade de material.
- OS é dona do consumo/execução.
- Suprimentos é dono do atendimento, reserva e compra.
- Financeiro é dono da obrigação/caixa.

## Necessidade de material
Cada item deve carregar:
- Necessidade_ID
- Projeto_ID
- EAP_ID/Pacote_ID
- OS_ID opcional
- Material_ID
- Origem_Material: ELETRIUM | CLIENTE | MISTA
- Quantidade_Planejada
- Data_Necessaria
- Criticidade
- Responsavel_Atendimento
- Snapshot_Versao
- Status_Atendimento

## Projetos longos
- baseline versionado de materiais;
- revisões não sobrescrevem histórico;
- troca de equipe não troca propriedade do material;
- consumo pode ocorrer por múltiplas OS;
- medição referencia quantitativos executados, não apenas material entregue;
- sobra, devolução, perda e transferência permanecem vinculadas ao projeto/origem.

## Falta de material
Falta confirmada gera `Solicitacao_Compra_ID` vinculada à Necessidade_ID e ao item de projeto. É proibida compra P0 sem rastreabilidade até Projeto_ID + item.

## Testes Gate C
- TS-18: necessidade nasce vinculada ao projeto e snapshot.
- TS-19: origem CLIENTE não gera custo/estoque Eletrium indevido.
- TS-20: MISTA mantém parcelas de propriedade/custo separadas.
- TS-21: falta gera solicitação de compra rastreável.

## Não colisão
Não escrever em `os.html` nem alterar máquina de estados de OS. `OS_ID` é tratado como referência externa opcional até estabilização da trilha OS.