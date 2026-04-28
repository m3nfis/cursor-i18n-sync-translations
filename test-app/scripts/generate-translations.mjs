#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localesDir = path.resolve(__dirname, '../src/locales')
const enPath = path.join(localesDir, 'i18n-en.json')

const catalogByLang = {
  es: {
    pageTitle: 'Reserva tu estancia en "Seabreeze Hotel"',
    heroSubtitle: 'Habitaciones con vista al mar desde <strong>{price}</strong> por noche.',
    guestLabel: 'Huéspedes',
    nightsLabel: 'Noches',
    languagePickerLabel: 'Idioma',
    checkInLabel: 'Llegada',
    checkOutLabel: 'Salida',
    ctaButton: 'Ver disponibilidad',
    trustNote: '<em>Cancelación gratis</em> hasta 24 horas antes de la llegada.',
    roomSummary: '{nights} noches para {guests} huéspedes',
    breakfastToggle: 'Incluir desayuno (+"{fee}")',
    footerHelp: '¿Necesitas ayuda? Chatea con "Luna" 24/7.',
    roomOptions: 'Nuestro portafolio incluye las categorías <strong>Standard</strong>, <strong>Deluxe Vista al Mar</strong> y <strong>Suite Penthouse</strong>, cada una sujeta a límites de ocupación, ventanas de bloqueo y umbrales de estancia mínima que varían según la temporada y la clase de tarifa.',
    legalDisclaimer: 'Al continuar, el Huésped reconoce que todas las tarifas mostradas son <em>indicativas y no vinculantes</em> hasta que se emita una confirmación por escrito, y que "Seabreeze Hotel" se reserva el derecho de modificar, suspender o rescindir cualquier reserva conforme a la jurisdicción aplicable y a las disposiciones de fuerza mayor.',
    cancellationTerms: 'Los reembolsos equivalentes al <strong>{refundPct}</strong> del importe prepagado se procesan en un plazo de {refundDays} días hábiles, excluidos fines de semana, festivos oficiales y cualquier recargo no reembolsable aplicado por proveedores externos o intermediarios de pago.',
  },
  fr: {
    pageTitle: 'Réservez votre séjour au "Seabreeze Hotel"',
    heroSubtitle: 'Chambres vue mer à partir de <strong>{price}</strong> par nuit.',
    guestLabel: 'Voyageurs',
    nightsLabel: 'Nuits',
    languagePickerLabel: 'Langue',
    checkInLabel: 'Arrivée',
    checkOutLabel: 'Départ',
    ctaButton: 'Vérifier les disponibilités',
    trustNote: '<em>Annulation gratuite</em> jusqu\'à 24 heures avant l\'arrivée.',
    roomSummary: '{nights} nuits pour {guests} voyageurs',
    breakfastToggle: 'Ajouter le petit-déjeuner (+"{fee}")',
    footerHelp: 'Besoin d\'aide ? Discutez avec "Luna" 24/7.',
    roomOptions: 'Notre portefeuille comprend les catégories <strong>Standard</strong>, <strong>Deluxe Vue Mer</strong> et <strong>Suite Penthouse</strong>, chacune soumise à des plafonds d\'occupation, des périodes de blocage et des seuils de séjour minimum qui varient selon la saison et la classe tarifaire.',
    legalDisclaimer: 'En poursuivant, le Client reconnaît que tous les tarifs affichés sont <em>indicatifs et non contractuels</em> jusqu\'à l\'émission d\'une confirmation écrite, et que "Seabreeze Hotel" se réserve le droit de modifier, suspendre ou annuler toute réservation conformément à la juridiction applicable et aux clauses de force majeure.',
    cancellationTerms: 'Les remboursements équivalant à <strong>{refundPct}</strong> du montant prépayé sont traités sous {refundDays} jours ouvrés, hors week-ends, jours fériés officiels et tous frais non remboursables prélevés par des prestataires tiers ou des intermédiaires de paiement.',
  },
  zh: {
    pageTitle: '预订您在 "Seabreeze Hotel" 的住宿',
    heroSubtitle: '海景客房每晚 <strong>{price}</strong> 起。',
    guestLabel: '住客人数',
    nightsLabel: '晚数',
    languagePickerLabel: '语言',
    checkInLabel: '入住',
    checkOutLabel: '退房',
    ctaButton: '查看可订房间',
    trustNote: '<em>免费取消</em>，最晚至入住前 24 小时。',
    roomSummary: '{nights} 晚，{guests} 位住客',
    breakfastToggle: '包含早餐 (+"{fee}")',
    footerHelp: '需要帮助？与 "Luna" 24/7 聊天。',
    roomOptions: '我们的房型包括 <strong>标准房</strong>、<strong>豪华海景房</strong> 和 <strong>顶层套房</strong>，每种房型均受入住人数上限、不可预订期及最短入住天数的限制，且依季节和价位等级而变化。',
    legalDisclaimer: '继续即表示客人确认所显示的房价均为 <em>仅供参考且不具约束力</em>，须以书面确认为准；"Seabreeze Hotel" 保留依据适用司法辖区及不可抗力条款修改、暂停或取消任何预订的权利。',
    cancellationTerms: '相当于预付金额 <strong>{refundPct}</strong> 的退款将在 {refundDays} 个工作日内处理，不含周末、法定节假日及第三方供应商或支付中介收取的任何不可退还附加费。',
  },
}

const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'))
const enKeys = Object.keys(enData)

for (const [lang, translations] of Object.entries(catalogByLang)) {
  const next = {}
  for (const key of enKeys) {
    next[key] = translations[key] ?? enData[key]
  }
  const filePath = path.join(localesDir, `i18n-${lang}.json`)
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  process.stdout.write(`Generated ${path.basename(filePath)}\n`)
}
