# SUP-G — Execução do piloto-sombra

## Comando único

```bash
node tests/run-suprimentos.js
node tests/run-suprimentos.js --json
```

O runner descobre todas as suítes `tests/suprimentos-*.test.js`, executa cada uma em
processo isolado e falha se qualquer suíte retornar código diferente de zero.

A demonstração navegável e totalmente local está em `suprimentos/demo-shadow.html`.
Ela reconstrói saldo e simula divergência de projeção sem modificar
`suprimentos.html` e sem qualquer chamada externa.

## Entrada

- branch derivada de `active-suprimentos-v1.2.1-20260824`;
- somente dados marcados `syntheticOnly=true`;
- nenhum segredo, CPF/CNPJ real, fornecedor real ou documento fiscal real;
- adapters externos substituídos por fakes/transports injetados;
- `suprimentos.html`, CRM e OS fora do ensaio.

## Cenário canônico

`Proposta → Projeto → Pacote → Necessidade → Falta → Solicitação → Cotação → Aprovação
→ Pedido → Recebimento → Staging NF-e → Matching → Entrada → Projeção → Reconciliação
→ Resolução da exceção`

## Falhas injetadas

- antes do commit: efeito zero;
- após commit/antes do ACK: retry devolve replay;
- ETag 412: conflito visível;
- paginação incompleta: commit proibido;
- consumo escrito sem movimento: reconciliação crítica;
- NF-e duplicada: rejeição explícita;
- timeout Bom Controle: fora do piloto A-F e bloqueado pelo Gate 0.

## Critérios de saída

- 100% das suítes verdes;
- nenhum arquivo protegido alterado;
- zero duplicidade de ledger em retry;
- projeção reconstruída igual à expectativa da fixture;
- nenhuma exceção crítica encerrada sem evidência;
- relatório JSON arquivável;
- Gate H permanece fechado.

## Rollback

O piloto não produz efeitos externos. Rollback consiste em descartar a branch/fixture.
Quando houver adapter homologado, o rollback será por eventos compensatórios e
reconstrução da projeção, nunca por exclusão de ledger.
