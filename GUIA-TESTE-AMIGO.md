# DaazNexus Desktop — guia rápido para testar

Olá! Isto é uma aplicação que põe uma inteligência artificial a trabalhar
directamente no teu computador — incluindo dentro do **AutoCAD**. Está em
fase de testes e é por isso que te peço para experimentares.

São 4 passos e demora cerca de 15 minutos. Não precisas de perceber nada
de IA.

---

## Passo 1 — Instalar (2 min)

1. Descarrega o instalador aqui:
   **https://github.com/daazlabs/nexus-desktop/releases/latest**
   O ficheiro é o **`DaazNexus-Setup-....exe`** (ignora todos os outros).
2. Abre o ficheiro. O Windows vai mostrar um aviso azul —
   *"O Windows protegeu o seu PC"*. É normal: a aplicação ainda não está
   registada na Microsoft, o que custa dinheiro e ainda não fizemos.
   Clica em **Mais informações** → **Executar mesmo assim**.
3. A aplicação abre sozinha no fim.

---

## Passo 2 — Dar-lhe um "cérebro" (5 min)

A aplicação não pensa sozinha: liga-se a serviços de IA na internet. Vais
buscar uma chave gratuita a alguns deles. **Não é preciso cartão de
crédito em nenhum destes.**

Para isso, vais ao menu em cima, onde diz "Provider" 5º botão a contar da esqueda. 
Depois de entrares, no separador "FREE" vais ver uma lista de "Providers" e cada um tem um link de acesso para poderes 
Criar conta: 

Faz pelo menos dois, idealmente três — se um estiver ocupado, a aplicação
salta automaticamente para outro.

| Serviço | Onde ir buscar a chave |
|---|---|
| **Groq** (o mais rápido) | https://console.groq.com/keys |
| **Google Gemini** (o mais capaz) | https://aistudio.google.com/app/apikey |
| **Cerebras** | https://cloud.cerebras.ai/ |
| **Mistral** (europeu) | https://console.mistral.ai/api-keys/ |

Em cada um: cria conta (podes entrar com o Google), procura o botão de
criar chave — *Create API Key* — e **copia** o texto comprido que aparece.
Copia-o logo, porque alguns só o mostram uma vez.

Depois, na aplicação tens de aplicar essa chave (API):

1. Clica no ícone de **definições** (a roda dentada).
2. Separador **FREE**.
3. Encontra o serviço na lista, cola a chave no campo e clica em **Guardar**.
4. Repete para os outros.

Já podes conversar com ela como conversarias com o ChatGPT.

---

## Passo 3 — Ligar o AutoCAD (3 min)

1. **Abre primeiro o AutoCAD**, com um desenho aberto (pode ser um novo,
   em branco).
2. Na aplicação: **definições** (PROVIDER) → separador **CONNECTORS** → cartão
   **AutoCAD** → botão **Ligar AutoCAD**.
3. Espera. Na primeira vez demora 1 a 3 minutos: a aplicação descarrega
   sozinha as ferramentas de que precisa (cerca de 40 MB). Não tens de
   instalar nada à mão. Podes ver o que está a fazer no texto por baixo da
   barra.
4. Quando o cartão ficar verde a dizer **Ligado**, está pronto.

Se disser *"Confirma que o AutoCAD está aberto"*, é mesmo isso: o AutoCAD
tem de estar aberto antes de carregares no botão.

---

## Passo 4 — Experimentar

Volta à conversa (CHAT) e escreve em português, como se pedisses a um colega teu.
Exemplos para começar:

- *"Desenha um rectângulo de 100 por 50 na origem."*
- *"Faz-me uma planta simples de um quarto de 4x3 metros com uma porta."*
- *"Desenha uma circunferência de raio 25 no ponto 200,200 e mete a cota."*
- *"Escreve o texto 'PLANTA PISO 0' por cima do desenho."*
- *"Grava o desenho."*

Vais ver as linhas a aparecer no AutoCAD enquanto ela trabalha.

**O que ela sabe fazer hoje no AutoCAD:** linhas, círculos, arcos, elipses,
polilinhas, rectângulos, texto, tramas/hachuras, cotas, e gravar o
desenho. É geometria de base — não substitui o teu trabalho, ajuda na
parte repetitiva.

**Fora do AutoCAD**, e é aqui que costuma surpreender, ela também:

- lê e escreve ficheiros no teu computador (podes pedir-lhe para
  organizar uma pasta, ou ler um PDF e resumir);
- cria folhas de **Excel**, documentos **Word** e apresentações
  **PowerPoint** a partir de uma descrição tua;
- responde a perguntas normais, como qualquer assistente de IA.

Exemplo real: *"Lê este mapa de medições em PDF e faz-me uma folha de
Excel com as quantidades por capítulo."*

IMPORTANTE: Para ele poder criar ficheiros, pastas, etc. tem que estar em modo "BUILD"!

---

## O que te peço

Anota o que correr mal, o que não percebeste, e o que te pareceu confuso —
sobretudo se ficares "preso" nalgum ecrã sem saber o que fazer a seguir.
É precisamente isso que preciso de saber. Se alguma coisa der erro, tira
uma fotografia ao ecrã.

Obrigado!
