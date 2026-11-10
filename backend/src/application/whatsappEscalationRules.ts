function normalizeMessage(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

const humanHandoffPattern = /\b(?:(?:quero|gostaria|preciso|prefiro|posso|pode|poderia|tem como) (?:falar|conversar|ser atendid[oa]) com (?:uma? )?(?:pessoa(?: real| humana| de verdade)?|gente|ser humano|humano|atendente)|(?:quero|gostaria|preciso|prefiro|pode|poderia) (?:falar|conversar|ser atendid[oa]) com (?:o )?cristhian[,]? (?:que (?:e|seja) )?(?:e )?(?:uma? )?(?:humano|pessoa real|pessoa humana|pessoa de verdade|de verdade|pessoalmente)|(?:quero|gostaria|preciso|prefiro) (?:uma? )?(?:pessoa(?: real| humana| de verdade)?|gente|ser humano|humano|atendente)|(?:quero|gostaria|preciso|prefiro) (?:atendimento|ajuda|ser atendid[oa]) humano|(?:me )?(?:encaminha|transfere|conecta|passa) (?:para|pro|pra|com) (?:uma? )?(?:pessoa(?: real| humana| de verdade)?|gente|ser humano|humano|atendente))\b/i
const cristhianAddressPattern = /\b(?:(?:quero|gostaria|preciso|prefiro|pode|poderia|tem como) (?:falar|conversar|ser atendid[oa]) com (?:o )?cristhian|(?:me )?(?:chama|passa|conecta) (?:o )?cristhian)\b/i
const commercialHandoffPattern = /\b(?:qual (?:e )?(?:o )?(?:preco|valor|custo|investimento)|quanto (?:custa|fica|ficaria|sai|seria|voces cobram|voces cobrariam|de investimento)|me passa(?:m)? (?:o )?(?:preco|valor|orcamento)|quero saber (?:o )?(?:preco|valor|orcamento)|tem (?:algum )?(?:preco|valor|desconto)|faz(?:em)? (?:por menos|desconto)|qual (?:e )?(?:o )?prazo|quanto tempo (?:demora|leva|fica|seria)|quando (?:fica pronto|entrega|comeca)|como (?:funciona|sao) (?:as )?condicoes? (?:comerciais|de pagamento)|formas? de pagamento|condicoes? de pagamento|pagamento (?:do|pelo) (?:projeto|servico|orcamento|contrato)|(?:voces )?aceitam (?:pix|cartao|parcelamento)|(?:posso|da para|tem como) pagar (?:no|com) (?:pix|cartao)|pagamento (?:mensal|recorrente)|(?:voces )?parcelam|quantas parcelas|parcelamento (?:do projeto|da proposta|do servico)|(?:tem|oferecem) garantia|resultado garantido|garantia de (?:resultado|venda|cliente)|(?:quero|gostaria(?: de)?|pode(?: me)? enviar|pode me mandar|manda|me envie|receber) (?:uma? )?(?:proposta|orcamento))\b/i

export function asksForHumanHandoff(text: string) {
  return humanHandoffPattern.test(normalizeMessage(text))
}

export function asksForCristhian(text: string) {
  return cristhianAddressPattern.test(normalizeMessage(text))
}

export function asksForUnapprovedCommercialTerms(text: string) {
  return commercialHandoffPattern.test(normalizeMessage(text))
}

export function requiresHumanReview(text: string) {
  return asksForHumanHandoff(text) || asksForUnapprovedCommercialTerms(text)
}
