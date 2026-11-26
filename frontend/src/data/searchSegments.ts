const segmentGroups = {
  'Alimentação': [
    'Restaurantes, padarias e lanchonetes', 'Restaurantes japoneses', 'Pizzarias',
    'Hamburguerias', 'Cafeterias', 'Padarias artesanais', 'Confeitarias', 'Buffets para eventos',
  ],
  'Saúde e odontologia': [
    'Clínicas e consultórios', 'Dentistas e clínicas odontológicas', 'Clínicas de implantes dentários',
    'Clínicas de ortodontia', 'Clínicas de fisioterapia', 'Consultórios de nutrição',
    'Consultórios de psicologia', 'Clínicas de oftalmologia', 'Clínicas de dermatologia',
  ],
  'Beleza e bem-estar': [
    'Salões e barbearias', 'Estética e bem-estar', 'Barbearias', 'Salões de beleza',
    'Esmalterias', 'Clínicas de estética facial', 'Clínicas de depilação a laser', 'Estúdios de sobrancelhas',
  ],
  'Esportes e atividade física': [
    'Academias e estúdios', 'Estúdios de pilates', 'Estúdios de yoga', 'Academias de musculação',
    'Boxes de cross training', 'Escolas de natação', 'Escolas de artes marciais',
  ],
  'Automotivo': [
    'Oficinas e serviços automotivos', 'Oficinas de câmbio automático', 'Oficinas de motos',
    'Funilaria e pintura automotiva', 'Estética automotiva', 'Lojas de pneus', 'Revendas de carros usados',
  ],
  'Varejo e comércio local': [
    'Lojas e comércio local', 'Lojas de roupas infantis', 'Lojas de moda feminina', 'Óticas',
    'Floriculturas', 'Lojas de material de construção', 'Lojas de móveis planejados', 'Lojas de produtos naturais',
  ],
  'Animais de estimação': [
    'Pet shops e veterinárias', 'Clínicas veterinárias 24 horas', 'Banho e tosa', 'Hotéis para cães', 'Adestradores de cães',
  ],
  'Imóveis e construção': [
    'Imobiliárias e corretores', 'Imobiliárias de alto padrão', 'Administradoras de condomínios',
    'Escritórios de arquitetura', 'Empresas de reformas residenciais', 'Instaladoras de energia solar',
  ],
  'Educação': [
    'Escolas e cursos', 'Escolas de inglês', 'Escolas de música', 'Escolas de educação infantil',
    'Autoescolas', 'Cursos profissionalizantes',
  ],
  'Serviços profissionais': [
    'Contabilidade e advocacia', 'Escritórios de contabilidade', 'Advocacia trabalhista',
    'Advocacia previdenciária', 'Corretoras de seguros', 'Consultorias de recursos humanos',
  ],
  'Casa e manutenção': [
    'Serviços residenciais', 'Instaladoras de ar-condicionado', 'Eletricistas residenciais',
    'Encanadores', 'Dedetizadoras', 'Empresas de limpeza residencial', 'Empresas de jardinagem',
  ],
  'Eventos e turismo': [
    'Espaços para festas', 'Fotógrafos de casamento', 'Cerimonialistas de casamento',
    'Pousadas', 'Agências de turismo', 'Empresas de aluguel de equipamentos para eventos',
  ],
}

export const segmentOptions = [
  { value: 'Todos os segmentos', label: 'Todos os segmentos' },
  ...Object.entries(segmentGroups).flatMap(([group, segments]) =>
    segments.map((segment) => ({ value: segment, label: segment, group })),
  ),
]
