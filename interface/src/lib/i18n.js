// Lightweight i18n for GeoDispatch.
//
// Two dictionaries — English (the default) and Arabic. Every user-facing string
// in the translated components is keyed here so a language switch in Settings
// redraws every label. No npm dependency: the dictionaries are plain objects
// and the lookup is a flat key.
//
// Usage in a component:
//
//   import { useT } from '../lib/i18n'
//   const t = useT()
//   ...
//   <span>{t('topbar.launch')}</span>
//
// `useT` reads the language from the SettingsContext, so it is reactive — when
// the operator picks Arabic every translated label redraws with the new
// strings. The shell that PROVIDES the context (App) cannot read it, so it
// binds its own store with `makeT(store)`, the way it does `makeDisplay`.
//
// Counts are written "label: n" in Arabic rather than "n label": an Arabic
// noun takes a different form for 1, 2, 3–10 and 11+, and one string cannot
// agree with all of them.
//
// French is offered in Settings but has no dictionary yet: it falls back to
// English, key by key. So does any key a dictionary is missing.

import { useContext } from 'solid-js'
import { SettingsContext } from './settings'
import { DASH } from './format'

// ── English ────────────────────────────────────────────────────────────────

const en = {
  // Top bar
  'topbar.setLocation':       'Set Location',
  'topbar.resolving':         'Resolving location…',
  'topbar.useMyLocation':     'Use my location',
  'topbar.setLocationMenu':   'Set location',
  'topbar.placePlaceholder':  'Search a city, or 31.06, -8.38',
  'topbar.placeLabel':        'Search a place or coordinates',
  'topbar.places':            'Places',
  'topbar.searching':         'Searching…',
  'topbar.placeError':        'Place search is unavailable. Coordinates still work.',
  'topbar.noPlace':           'No place by that name.',
  'topbar.coordinates':       'Coordinates',
  'topbar.placesCredit':      'Places: Photon · © OpenStreetMap contributors',
  'topbar.searchPlaceholder': 'Search devices, zones, or coordinates',
  'topbar.searchLabel':       'Search devices',
  'topbar.searchResults':     'Search results',
  'topbar.noMatch':           'No device matches that search.',
  'topbar.launch':            'Launch incident',
  'topbar.stopSim':           'Stop simulation',
  'topbar.stopSimTitle':      'Stop the simulation and return to the supervisor',
  'topbar.runSim':            'Run simulation',
  'topbar.runSimTitle':       'Run the last simulation again',
  'topbar.unnamedStation':    'Unnamed station',
  'topbar.notifNone':         'Notifications, none unresolved',
  'topbar.notifCount':        'Notifications, {0} unresolved',
  'topbar.accountLabel':      'Account: {0}. Open station profile.',
  'topbar.accountTitle':      'Station profile and console settings',

  // Nav rail
  'nav.map':            'Map',
  'nav.details':        'Details',
  'nav.rescue':         'Rescue',
  'nav.shelters':       'Shelters',
  'nav.devices':        'Devices',
  'nav.account':        'Account',
  'nav.settings':       'Settings',
  'nav.signout':        'Sign out',
  'nav.mapHint':        'Live map',
  'nav.detailsHint':    'Incident details',
  'nav.rescueHint':     'Rescue queue',
  'nav.sheltersHint':   'Shelters',
  'nav.devicesHint':    'Devices by area',
  'nav.accountHint':    'Station profile',
  'nav.settingsHint':   'Console settings',
  'nav.signoutHint':    'End shift and clear this station',
  'nav.mainSections':   'Main sections',
  'nav.accountSession': 'Account and session',

  // Map toolbar
  'toolbar.zones':        'Zones',
  'toolbar.devices':      'Devices',
  'toolbar.shelters':     'Shelters',
  'toolbar.fullscreen':   'Fullscreen',
  'toolbar.exportJson':   'Export JSON',
  'toolbar.mapControls':  'Map controls',
  'toolbar.mapLayers':    'Map layers',
  'toolbar.zonesHint':    'Show the red, orange and green zone rings',
  'toolbar.devicesHint':  'Show one dot per located device',
  'toolbar.sheltersHint': 'Show the shelter markers',
  'toolbar.toggleFull':   'Toggle fullscreen map',
  'toolbar.exportLabel':  'Export the current event and devices as JSON',
  'toolbar.layerLabel':   '{0} layer',

  // Stream chip — the words of lib/streamState.js's PHASE_TEXT
  'stream.connecting':   'Connecting',
  'stream.waiting':      'No frames yet',
  'stream.receiving':    'Receiving',
  'stream.stalled':      'Stalled',
  'stream.reconnecting': 'Reconnecting',
  'stream.lost':         'Connection lost',
  'stream.simulating':   'Simulation',

  // Map location control (bottom right of the map)
  'mapLocation.options':    'Map location options',
  'mapLocation.open':       'Open map location options',
  'mapLocation.title':      'Location',
  'mapLocation.finding':    'Finding your location…',
  'mapLocation.center':     'Center on this device',
  'mapLocation.goTo':       'Go to incident',
  'mapLocation.showZone':   'Show the disaster zone',
  'mapLocation.noIncident': 'No active incident',

  // Device details
  'device.overview':      'Device Overview',
  'device.status':        'Status',
  'device.location':      'Location',
  'device.aiDecision':    'AI Decision',
  'device.hide':          'Hide',
  'device.show':          'Show',
  'device.toggleLabel':   '{0} device details',
  'device.detailsRegion': 'Device details',
  'device.expand':        'Expand {0}',
  'device.collapse':      'Collapse {0}',

  'device.emptyOverview': 'Select a device on the map.',
  'device.emptyStatus':   'Select a device to view status.',
  'device.emptyLocation': 'Select a device to view location.',
  'device.emptyAi':       'Select a device to view its dispatch decision.',

  'device.reachability':     'Reachability',
  'device.stage':            'Stage',
  'device.sms':              'SMS',
  'device.rescue':           'Rescue',
  'device.distance':         'Distance',
  'device.coordinates':      'Coordinates',
  'device.accuracy':         'Accuracy',
  'device.action':           'Action',
  'device.priority':         'Priority',
  'device.confidence':       'Confidence',
  'device.computedNote':     'computed here — not sent by supervisor',
  'device.awaitingDecision': 'awaiting AI decision',
  'device.decisionFailed':   'AI decision failed',
  'device.escalation':       'AI escalation to {0}',
  'device.notFlagged':       'Not flagged',
  'device.flaggedWith':      'Flagged · {0}',
  'device.priorityNone':     'None',

  'distance.fromEpicenter': '{0} from epicenter',

  // Zone details — the same four cards, for a zone ring instead of a dot
  'zoneDetails.region':        'Zone details',
  'zoneDetails.overview':      'Zone Overview',
  'zoneDetails.ai':            'AI Situation Report',
  'zoneDetails.emptyOverview': 'Select a zone on the map.',
  'zoneDetails.emptyStatus':   'Select a zone to view device counts.',
  'zoneDetails.emptyLocation': 'Select a zone to view its location.',
  'zoneDetails.emptyAi':       'Select a zone to view its situation report.',
  'zoneDetails.waiting':       'Waiting for the first zone report.',
  'zoneDetails.devices':       'Devices',
  'zoneDetails.reachable':     'Reachable',
  'zoneDetails.reachableOf':   '{0} of {1}',
  'zoneDetails.rescue':        'Rescue',
  'zoneDetails.aftershock':    'Aftershock',
  'zoneDetails.tsunami':       'Tsunami',
  'zoneDetails.coastalRisk':   'Coastal risk present',
  'zoneDetails.band':          'Band',
  'zoneDetails.epicenter':     'Epicenter',
  'zoneDetails.radius':        'Impact radius',

  // Device stage, SMS and rescue status, reachability — lib/format.js's labels
  'stage.triaged':         'Located — awaiting AI decision',
  'stage.decided':         'Decided',
  'stage.decision_failed': 'AI decision failed',

  'sms.not_requested':  'Not requested',
  'sms.sent':           'Accepted by the SMS gateway',
  'sms.failed':         'Failed — the SMS gateway rejected it',
  'sms.not_configured': 'Not sent — no SMS gateway configured',

  'rescueStatus.not_requested': 'Not requested',
  'rescueStatus.recorded':      'Recorded',
  'rescueStatus.failed':        'Recording failed',

  'reach.CONNECTED_DATA': 'CONNECTED DATA',
  'reach.CONNECTED_SMS':  'CONNECTED SMS',
  'reach.NOT_CONNECTED':  'NOT CONNECTED',
  'reach.assumed':        '{0} (assumed — lookup failed)',

  // The AI's decision — what it ASKED for, not what happened. Whether an SMS
  // actually went out is the SMS status above.
  'action.sms':         'Send SMS',
  'action.rescue_flag': 'Flag for rescue',
  'action.both':        'SMS + rescue flag',
  'action.none':        'No action',

  // Zones
  'zone.red':    'Red zone',
  'zone.orange': 'Orange zone',
  'zone.green':  'Green zone',

  'zoneMeaning.red':    'Critical: immediate danger',
  'zoneMeaning.orange': 'High: evacuation recommended',
  'zoneMeaning.green':  'Moderate: alert and monitor',

  // Disaster types — inside a sentence, and as a heading
  'disaster.earthquake': 'earthquake',
  'disaster.flood':      'flood',
  'disaster.heatwave':   'heatwave',

  'disasterTitle.earthquake': 'Earthquake',
  'disasterTitle.flood':      'Flood',
  'disasterTitle.heatwave':   'Heatwave',

  // Only an earthquake has a magnitude; see severityLabel in lib/format.js
  'severity.earthquake': 'M {0}',
  'severity.flood':      'Flood severity {0}',
  'severity.heatwave':   'Heat severity {0}',
  'severity.other':      'Severity {0}',

  'risk.LOW':    'Low',
  'risk.MEDIUM': 'Medium',
  'risk.HIGH':   'High',

  // Ops panels
  'ops.rescueQueue':  'Rescue queue',
  'ops.flaggedCount': '{0} flagged',
  'ops.rescueEmpty':  'No devices are flagged for rescue.',
  'ops.priority':     'Priority {0}',
  'ops.showingFirst': 'Showing the first {0} of {1}.',
  'ops.rescueOrder':  "Ordered by the supervisor's rescue priority (P1 first), then distance. Flags come from any zone.",

  'ops.devices':       'Devices',
  'ops.locatedCount':  '{0} located',
  'ops.devicesEmpty':  'No devices located yet.',
  'ops.locatedLabel':  'Located',
  'ops.reachable':     'Reachable',
  'ops.unreachable':   'Unreachable',
  'ops.aiDecided':     'AI decided',
  'ops.aiFailed':      'AI decision failed',
  'ops.smsAccepted':   'SMS accepted by gateway',
  'ops.smsFailed':     'SMS failed',
  'ops.smsNoGateway':  'SMS not sent — no gateway',
  'ops.rescueFlagged': 'Rescue flagged',

  'ops.byZone':       'By zone',
  'ops.devicesCount': '{0} devices',
  'ops.zoneSub':      '{0} reachable · {1} rescue',
  'ops.noPlaceNames': 'Location names are not provided by the supervisor.',

  'ops.shelters':            'Shelters',
  'ops.listedCount':         '{0} listed',
  'ops.noIncident':          'No incident yet.',
  'ops.sheltersUnavailable': 'Shelter records unavailable (database query failed).',
  'ops.sheltersWaiting':     "Waiting for the supervisor's shelter lookup.",
  'ops.sheltersEmpty':       'No shelter records near this incident.',
  'ops.capacity':            'capacity {0}',
  'ops.sheltersNote':        "The nearest shelter records to the epicentre, from the supervisor's database.",
  'ops.sheltersSimNote':     'Simulated shelters, generated in this browser. Not real places.',
  'ops.noOccupancy':         'Occupancy is not recorded.',

  'ops.errors':        'Errors',
  'ops.receivedCount': '{0} received',
  'ops.errorsEmpty':   'No errors reported.',
  'ops.errorSub':      '{0} · latest {1}',
  'ops.fatal':         'Fatal',
  'ops.clearList':     'Clear the list',
  'ops.clearNote':     'Clears this list only.',

  // Error codes, as an operator reads them — constants/zones.js ERROR_SEVERITY
  'error.CAMARA_TIMEOUT':         'A network lookup timed out',
  'error.CAMARA_ERROR':           'A network lookup failed',
  'error.AGENT_ERROR':            'A batch got no AI decision',
  'error.AGENT_INVALID_RESPONSE': 'An AI answer was rejected as invalid',
  'error.SMS_FAILED':             'The SMS gateway did not accept a message',
  'error.DB_ERROR':               'A database operation failed',
  'error.QOS_FAILED':             "The network priority request didn't apply",
  'error.INTERNAL_ERROR':         'The supervisor hit an internal error',
  'error.unknown':                'Unclassified error from the supervisor',

  // Relative time — lib/format.js ago()
  'time.justNow': 'just now',
  'time.seconds': '{0}s ago',
  'time.minutes': '{0}m {1}s ago',
  'time.hours':   '{0}h {1}m ago',

  // Incident lifecycle — lib/format.js LIFECYCLE_LABELS
  'lifecycle.idle':                    'No incident',
  'lifecycle.running':                 'Running',
  'lifecycle.completed':               'Completed',
  'lifecycle.completed_with_failures': 'Completed with failures',
  'lifecycle.no_devices':              'No registered devices within radius',
  'lifecycle.failed':                  'Failed',

  // App shell
  'app.incidentDetails': 'Incident details',
  'app.rescueQueue':     'Rescue queue',
  'app.devicesLabel':    'Devices',
  'app.sheltersLabel':   'Shelters',
  'app.errorsLabel':     'Errors',
  'app.panel':           'Panel',

  'app.pipelineReported': 'Pipeline reported {0}.',
  'app.fatalError':       'a fatal error',
  'app.noDetail':         'No detail was sent.',
  'app.dispatchStopped':  'Dispatch has stopped at the supervisor.',
  'app.framesSinceOne':   'Anything that still arrives on the connection is applied to this board, and {0} frame has arrived since.',
  'app.framesSinceMany':  'Anything that still arrives on the connection is applied to this board, and {0} frames have arrived since.',
  'app.reconnect':        'Reconnect',
  'app.clearIncident':    'Clear incident',

  'app.ignoredOne':  'Ignored {0} frame from incident {1}. Resynchronizing {2}.',
  'app.ignoredMany': 'Ignored {0} frames from incident {1}. Resynchronizing {2}.',
  'app.theBoard':    'the board',

  'app.decidedOf':    '{0} of {1} triaged devices decided.',
  'app.smsNoGateway': '{0} SMS not sent — no SMS gateway configured.',

  'app.simTitle':    'Simulation.',
  'app.simBody':     'Synthetic devices, zones and shelters generated in this browser. Not real data, and nothing was sent to the supervisor.',
  'app.replay':      'Replay',
  'app.replayTitle': 'Run {0} again: {1} {2}, {3}, {4} radius',

  'app.noteNoLocation':        'Location unavailable. Pick a region from the Set Location list instead.',
  'app.noteNoRegion':          'No region named {0} is on the list.',
  'app.noteNoArea':            'No active incident area is available yet.',
  'app.noteNoFullscreen':      'This browser will not put the map into fullscreen.',
  'app.noteFullscreenRefused': 'The browser refused fullscreen for this page.',
  'app.noteListening':         'Listening on {0}. Waiting for the next frame.',
  'app.launchAccepted':        '{0} accepted: {1} {2}.',
  'app.launchDuplicate':       '{0} already accepted: {1} {2}.',
  'app.simPreparing':          'Preparing simulation {0}…',
  'app.simStarted':            'Simulation {0}: {1} synthetic devices. Not real data.',
  'app.simNoLand':             'Simulation {0}: no land inside the radius, so nobody to place.',
  'app.simStopped':            'Simulation stopped. Back on the supervisor.',
  'app.exported':              'Exported {0} devices as JSON.',
  'app.exportFailed':          'Export failed: {0}',
  'app.reconnecting':          'Reconnecting to the supervisor and requesting a fresh snapshot.',
  'app.cleared':               'Incident cleared. Waiting for the next event.',
}

// ── Arabic ─────────────────────────────────────────────────────────────────

const ar = {
  // Top bar
  'topbar.setLocation':       'تحديد الموقع',
  'topbar.resolving':         'جارٍ تحديد الموقع…',
  'topbar.useMyLocation':     'استخدام موقعي',
  'topbar.setLocationMenu':   'تحديد الموقع',
  'topbar.placePlaceholder':  'ابحث عن مدينة، أو 31.06, -8.38',
  'topbar.placeLabel':        'البحث عن مكان أو إحداثيات',
  'topbar.places':            'الأماكن',
  'topbar.searching':         'جارٍ البحث…',
  'topbar.placeError':        'البحث عن الأماكن غير متاح. الإحداثيات ما زالت تعمل.',
  'topbar.noPlace':           'لا يوجد مكان بهذا الاسم.',
  'topbar.coordinates':       'إحداثيات',
  'topbar.placesCredit':      'الأماكن: Photon · © مساهمو OpenStreetMap',
  'topbar.searchPlaceholder': 'ابحث عن الأجهزة أو المناطق أو الإحداثيات',
  'topbar.searchLabel':       'البحث عن الأجهزة',
  'topbar.searchResults':     'نتائج البحث',
  'topbar.noMatch':           'لا يوجد جهاز يطابق هذا البحث.',
  'topbar.launch':            'إطلاق حادث',
  'topbar.stopSim':           'إيقاف المحاكاة',
  'topbar.stopSimTitle':      'إيقاف المحاكاة والعودة إلى المشرف',
  'topbar.runSim':            'تشغيل المحاكاة',
  'topbar.runSimTitle':       'تشغيل آخر محاكاة مرة أخرى',
  'topbar.unnamedStation':    'محطة بدون اسم',
  'topbar.notifNone':         'الإشعارات، لا شيء غير محلول',
  'topbar.notifCount':        'الإشعارات، غير المحلولة: {0}',
  'topbar.accountLabel':      'الحساب: {0}. فتح ملف المحطة.',
  'topbar.accountTitle':      'ملف المحطة وإعدادات وحدة التحكم',

  // Nav rail
  'nav.map':            'الخريطة',
  'nav.details':        'التفاصيل',
  'nav.rescue':         'الإنقاذ',
  'nav.shelters':       'الملاجئ',
  'nav.devices':        'الأجهزة',
  'nav.account':        'الحساب',
  'nav.settings':       'الإعدادات',
  'nav.signout':        'تسجيل الخروج',
  'nav.mapHint':        'الخريطة المباشرة',
  'nav.detailsHint':    'تفاصيل الحادث',
  'nav.rescueHint':     'طابور الإنقاذ',
  'nav.sheltersHint':   'الملاجئ',
  'nav.devicesHint':    'الأجهزة حسب المنطقة',
  'nav.accountHint':    'ملف المحطة',
  'nav.settingsHint':   'إعدادات وحدة التحكم',
  'nav.signoutHint':    'إنهاء المناوبة ومسح هذه المحطة',
  'nav.mainSections':   'الأقسام الرئيسية',
  'nav.accountSession': 'الحساب والجلسة',

  // Map toolbar
  'toolbar.zones':        'المناطق',
  'toolbar.devices':      'الأجهزة',
  'toolbar.shelters':     'الملاجئ',
  'toolbar.fullscreen':   'ملء الشاشة',
  'toolbar.exportJson':   'تصدير JSON',
  'toolbar.mapControls':  'أدوات الخريطة',
  'toolbar.mapLayers':    'طبقات الخريطة',
  'toolbar.zonesHint':    'إظهار حلقات المنطقة الحمراء والبرتقالية والخضراء',
  'toolbar.devicesHint':  'إظهار نقطة لكل جهاز محدد الموقع',
  'toolbar.sheltersHint': 'إظهار علامات الملاجئ',
  'toolbar.toggleFull':   'تبديل ملء الشاشة للخريطة',
  'toolbar.exportLabel':  'تصدير الحدث الحالي والأجهزة بصيغة JSON',
  'toolbar.layerLabel':   'طبقة {0}',

  // Stream chip
  'stream.connecting':   'جارٍ الاتصال',
  'stream.waiting':      'لا توجد إطارات بعد',
  'stream.receiving':    'جارٍ الاستقبال',
  'stream.stalled':      'متوقف',
  'stream.reconnecting': 'إعادة الاتصال',
  'stream.lost':         'انقطع الاتصال',
  'stream.simulating':   'محاكاة',

  // Map location control
  'mapLocation.options':    'خيارات موقع الخريطة',
  'mapLocation.open':       'فتح خيارات موقع الخريطة',
  'mapLocation.title':      'الموقع',
  'mapLocation.finding':    'جارٍ تحديد موقعك…',
  'mapLocation.center':     'التوسيط على هذا الجهاز',
  'mapLocation.goTo':       'الانتقال إلى الحادث',
  'mapLocation.showZone':   'إظهار منطقة الكارثة',
  'mapLocation.noIncident': 'لا يوجد حادث نشط',

  // Device details
  'device.overview':      'نظرة عامة على الجهاز',
  'device.status':        'الحالة',
  'device.location':      'الموقع',
  'device.aiDecision':    'قرار الذكاء الاصطناعي',
  'device.hide':          'إخفاء',
  'device.show':          'إظهار',
  'device.toggleLabel':   '{0} تفاصيل الجهاز',
  'device.detailsRegion': 'تفاصيل الجهاز',
  'device.expand':        'توسيع {0}',
  'device.collapse':      'طي {0}',

  'device.emptyOverview': 'اختر جهازاً على الخريطة.',
  'device.emptyStatus':   'اختر جهازاً لعرض حالته.',
  'device.emptyLocation': 'اختر جهازاً لعرض موقعه.',
  'device.emptyAi':       'اختر جهازاً لعرض قرار الإرسال الخاص به.',

  'device.reachability':     'إمكانية الوصول',
  'device.stage':            'المرحلة',
  'device.sms':              'رسالة قصيرة',
  'device.rescue':           'الإنقاذ',
  'device.distance':         'المسافة',
  'device.coordinates':      'الإحداثيات',
  'device.accuracy':         'الدقة',
  'device.action':           'الإجراء',
  'device.priority':         'الأولوية',
  'device.confidence':       'مستوى الثقة',
  'device.computedNote':     'محسوبة هنا — لم يرسلها المشرف',
  'device.awaitingDecision': 'بانتظار قرار الذكاء الاصطناعي',
  'device.decisionFailed':   'فشل قرار الذكاء الاصطناعي',
  'device.escalation':       'تصعيد من الذكاء الاصطناعي إلى {0}',
  'device.notFlagged':       'غير معلّم',
  'device.flaggedWith':      'معلّم · {0}',
  'device.priorityNone':     'لا توجد',

  'distance.fromEpicenter': 'على بعد {0} من مركز الزلزال',

  // Zone details
  'zoneDetails.region':        'تفاصيل المنطقة',
  'zoneDetails.overview':      'نظرة عامة على المنطقة',
  'zoneDetails.ai':            'تقرير الوضع من الذكاء الاصطناعي',
  'zoneDetails.emptyOverview': 'اختر منطقة على الخريطة.',
  'zoneDetails.emptyStatus':   'اختر منطقة لعرض عدد الأجهزة فيها.',
  'zoneDetails.emptyLocation': 'اختر منطقة لعرض موقعها.',
  'zoneDetails.emptyAi':       'اختر منطقة لعرض تقرير الوضع الخاص بها.',
  'zoneDetails.waiting':       'بانتظار أول تقرير عن المنطقة.',
  'zoneDetails.devices':       'الأجهزة',
  'zoneDetails.reachable':     'يمكن الوصول إليها',
  'zoneDetails.reachableOf':   '{0} من أصل {1}',
  'zoneDetails.rescue':        'الإنقاذ',
  'zoneDetails.aftershock':    'الهزات الارتدادية',
  'zoneDetails.tsunami':       'تسونامي',
  'zoneDetails.coastalRisk':   'يوجد خطر على الساحل',
  'zoneDetails.band':          'النطاق',
  'zoneDetails.epicenter':     'مركز الزلزال',
  'zoneDetails.radius':        'نصف قطر التأثير',

  // Device stage, SMS and rescue status, reachability
  'stage.triaged':         'تم تحديد الموقع — بانتظار قرار الذكاء الاصطناعي',
  'stage.decided':         'تم البت',
  'stage.decision_failed': 'فشل قرار الذكاء الاصطناعي',

  'sms.not_requested':  'غير مطلوبة',
  'sms.sent':           'قبلتها بوابة الرسائل القصيرة',
  'sms.failed':         'فشلت — رفضتها بوابة الرسائل القصيرة',
  'sms.not_configured': 'لم تُرسل — لا توجد بوابة رسائل قصيرة مهيأة',

  'rescueStatus.not_requested': 'غير مطلوب',
  'rescueStatus.recorded':      'مسجّل',
  'rescueStatus.failed':        'فشل التسجيل',

  'reach.CONNECTED_DATA': 'متصل (بيانات)',
  'reach.CONNECTED_SMS':  'متصل (رسائل قصيرة)',
  'reach.NOT_CONNECTED':  'غير متصل',
  'reach.assumed':        '{0} (مفترض — فشل الاستعلام)',

  // The AI's decision — what it asked for, not what happened.
  'action.sms':         'إرسال رسالة قصيرة',
  'action.rescue_flag': 'تعليم للإنقاذ',
  'action.both':        'رسالة قصيرة + تعليم للإنقاذ',
  'action.none':        'لا إجراء',

  // Zones
  'zone.red':    'المنطقة الحمراء',
  'zone.orange': 'المنطقة البرتقالية',
  'zone.green':  'المنطقة الخضراء',

  'zoneMeaning.red':    'حرجة: خطر مباشر',
  'zoneMeaning.orange': 'عالية: يوصى بالإخلاء',
  'zoneMeaning.green':  'متوسطة: تنبيه ومراقبة',

  // Disaster types
  'disaster.earthquake': 'زلزال',
  'disaster.flood':      'فيضان',
  'disaster.heatwave':   'موجة حر',

  'disasterTitle.earthquake': 'زلزال',
  'disasterTitle.flood':      'فيضان',
  'disasterTitle.heatwave':   'موجة حر',

  'severity.earthquake': 'M {0}',
  'severity.flood':      'شدة الفيضان {0}',
  'severity.heatwave':   'شدة الحر {0}',
  'severity.other':      'الشدة {0}',

  'risk.LOW':    'منخفض',
  'risk.MEDIUM': 'متوسط',
  'risk.HIGH':   'مرتفع',

  // Ops panels
  'ops.rescueQueue':  'طابور الإنقاذ',
  'ops.flaggedCount': 'المعلّمة: {0}',
  'ops.rescueEmpty':  'لا توجد أجهزة معلّمة للإنقاذ.',
  'ops.priority':     'الأولوية {0}',
  'ops.showingFirst': 'عرض أول {0} من أصل {1}.',
  'ops.rescueOrder':  'مرتبة حسب أولوية الإنقاذ لدى المشرف (P1 أولاً)، ثم حسب المسافة. قد تأتي العلامات من أي منطقة.',

  'ops.devices':       'الأجهزة',
  'ops.locatedCount':  'محددة الموقع: {0}',
  'ops.devicesEmpty':  'لم يتم تحديد موقع أي جهاز بعد.',
  'ops.locatedLabel':  'محددة الموقع',
  'ops.reachable':     'يمكن الوصول إليها',
  'ops.unreachable':   'لا يمكن الوصول إليها',
  'ops.aiDecided':     'قرر الذكاء الاصطناعي',
  'ops.aiFailed':      'فشل قرار الذكاء الاصطناعي',
  'ops.smsAccepted':   'رسائل قبلتها البوابة',
  'ops.smsFailed':     'رسائل فشلت',
  'ops.smsNoGateway':  'رسائل لم تُرسل — لا توجد بوابة',
  'ops.rescueFlagged': 'معلّمة للإنقاذ',

  'ops.byZone':       'حسب المنطقة',
  'ops.devicesCount': 'الأجهزة: {0}',
  'ops.zoneSub':      'يمكن الوصول: {0} · الإنقاذ: {1}',
  'ops.noPlaceNames': 'المشرف لا يرسل أسماء الأماكن.',

  'ops.shelters':            'الملاجئ',
  'ops.listedCount':         'المدرجة: {0}',
  'ops.noIncident':          'لا يوجد حادث بعد.',
  'ops.sheltersUnavailable': 'سجلات الملاجئ غير متاحة (فشل استعلام قاعدة البيانات).',
  'ops.sheltersWaiting':     'بانتظار بحث المشرف عن الملاجئ.',
  'ops.sheltersEmpty':       'لا توجد سجلات ملاجئ قرب هذا الحادث.',
  'ops.capacity':            'السعة {0}',
  'ops.sheltersNote':        'أقرب سجلات الملاجئ إلى مركز الزلزال، من قاعدة بيانات المشرف.',
  'ops.sheltersSimNote':     'ملاجئ محاكاة أُنشئت في هذا المتصفح. ليست أماكن حقيقية.',
  'ops.noOccupancy':         'الإشغال غير مسجّل.',

  'ops.errors':        'الأخطاء',
  'ops.receivedCount': 'المستلمة: {0}',
  'ops.errorsEmpty':   'لم يتم الإبلاغ عن أي أخطاء.',
  'ops.errorSub':      '{0} · الأحدث {1}',
  'ops.fatal':         'حرج',
  'ops.clearList':     'مسح القائمة',
  'ops.clearNote':     'يمسح هذه القائمة فقط.',

  // Error codes
  'error.CAMARA_TIMEOUT':         'انتهت مهلة استعلام الشبكة',
  'error.CAMARA_ERROR':           'فشل استعلام الشبكة',
  'error.AGENT_ERROR':            'دفعة لم تحصل على قرار من الذكاء الاصطناعي',
  'error.AGENT_INVALID_RESPONSE': 'رُفضت إجابة الذكاء الاصطناعي لأنها غير صالحة',
  'error.SMS_FAILED':             'لم تقبل بوابة الرسائل القصيرة رسالة',
  'error.DB_ERROR':               'فشلت عملية في قاعدة البيانات',
  'error.QOS_FAILED':             'لم يُطبَّق طلب أولوية الشبكة',
  'error.INTERNAL_ERROR':         'واجه المشرف خطأً داخلياً',
  'error.unknown':                'خطأ غير مصنف من المشرف',

  // Relative time
  'time.justNow': 'الآن',
  'time.seconds': 'منذ {0} ث',
  'time.minutes': 'منذ {0} د {1} ث',
  'time.hours':   'منذ {0} س {1} د',

  // Incident lifecycle
  'lifecycle.idle':                    'لا يوجد حادث',
  'lifecycle.running':                 'قيد التشغيل',
  'lifecycle.completed':               'اكتمل',
  'lifecycle.completed_with_failures': 'اكتمل مع إخفاقات',
  'lifecycle.no_devices':              'لا توجد أجهزة مسجلة داخل النطاق',
  'lifecycle.failed':                  'فشل',

  // App shell
  'app.incidentDetails': 'تفاصيل الحادث',
  'app.rescueQueue':     'طابور الإنقاذ',
  'app.devicesLabel':    'الأجهزة',
  'app.sheltersLabel':   'الملاجئ',
  'app.errorsLabel':     'الأخطاء',
  'app.panel':           'لوحة',

  'app.pipelineReported': 'أبلغ خط المعالجة عن {0}.',
  'app.fatalError':       'خطأ حرج',
  'app.noDetail':         'لم تُرسل أي تفاصيل.',
  'app.dispatchStopped':  'توقف الإرسال لدى المشرف.',
  'app.framesSinceOne':   'كل ما يصل عبر الاتصال يُطبَّق على هذه اللوحة. الإطارات التي وصلت منذ ذلك الحين: {0}.',
  'app.framesSinceMany':  'كل ما يصل عبر الاتصال يُطبَّق على هذه اللوحة. الإطارات التي وصلت منذ ذلك الحين: {0}.',
  'app.reconnect':        'إعادة الاتصال',
  'app.clearIncident':    'مسح الحادث',

  'app.ignoredOne':  'تم تجاهل إطارات من الحادث {1} (العدد: {0}). جارٍ إعادة مزامنة {2}.',
  'app.ignoredMany': 'تم تجاهل إطارات من الحادث {1} (العدد: {0}). جارٍ إعادة مزامنة {2}.',
  'app.theBoard':    'اللوحة',

  'app.decidedOf':    'تم البت في {0} من أصل {1} من الأجهزة المفرزة.',
  'app.smsNoGateway': 'رسائل قصيرة لم تُرسل: {0} — لا توجد بوابة رسائل قصيرة مهيأة.',

  'app.simTitle':    'محاكاة.',
  'app.simBody':     'أجهزة ومناطق وملاجئ اصطناعية أُنشئت في هذا المتصفح. ليست بيانات حقيقية، ولم يُرسل أي شيء إلى المشرف.',
  'app.replay':      'إعادة التشغيل',
  'app.replayTitle': 'تشغيل {0} مرة أخرى: {2} {1}، {3}، نصف القطر {4}',

  'app.noteNoLocation':        'الموقع غير متاح. اختر منطقة من قائمة تحديد الموقع بدلاً من ذلك.',
  'app.noteNoRegion':          'لا توجد منطقة باسم {0} في القائمة.',
  'app.noteNoArea':            'لا توجد منطقة حادث نشطة بعد.',
  'app.noteNoFullscreen':      'هذا المتصفح لا يعرض الخريطة بملء الشاشة.',
  'app.noteFullscreenRefused': 'رفض المتصفح وضع ملء الشاشة لهذه الصفحة.',
  'app.noteListening':         'جارٍ الاستماع على {0}. بانتظار الإطار التالي.',
  'app.launchAccepted':        'تم قبول {0}: {2} {1}.',
  'app.launchDuplicate':       'سبق قبول {0}: {2} {1}.',
  'app.simPreparing':          'جارٍ تحضير المحاكاة {0}…',
  'app.simStarted':            'المحاكاة {0}: عدد الأجهزة الاصطناعية {1}. ليست بيانات حقيقية.',
  'app.simNoLand':             'المحاكاة {0}: لا توجد يابسة داخل النطاق، فلا أحد يمكن وضعه.',
  'app.simStopped':            'توقفت المحاكاة. العودة إلى المشرف.',
  'app.exported':              'تم تصدير الأجهزة ({0}) بصيغة JSON.',
  'app.exportFailed':          'فشل التصدير: {0}',
  'app.reconnecting':          'جارٍ إعادة الاتصال بالمشرف وطلب لقطة جديدة.',
  'app.cleared':               'تم مسح الحادث. بانتظار الحدث التالي.',
}

// ── Lookup ─────────────────────────────────────────────────────────────────

const DICTIONARIES = { en, ar }

/**
 * Look up a translation key in the given language. Falls back to English,
 * then to the key itself (so a missing key is visible, not silent).
 *
 * Positional interpolation: {0}, {1}, … — in any order, so a translation can
 * put the words where its own grammar wants them. An argument is inserted as
 * is and never read for placeholders itself.
 */
export function t(key, lang = 'en', ...args) {
  const dict = DICTIONARIES[lang] || DICTIONARIES.en
  const text = dict[key] ?? DICTIONARIES.en[key] ?? key
  if (!args.length) return text
  return text.replace(/\{(\d+)\}/g, (match, i) => (Number(i) < args.length ? String(args[i]) : match))
}

/** True when `key` is in the English dictionary — every real key is. */
export function hasKey(key) {
  return Object.prototype.hasOwnProperty.call(en, key)
}

/**
 * A `t()` bound to a settings store. The language is read on every call, so
 * inside JSX or an accessor it is reactive. For the shell that owns the store
 * (App), which cannot read the context it is itself providing.
 *
 * `translate.lang()` is the current language key.
 */
export function makeT(store) {
  const lang = () => (store ? store.settings.language : 'en')
  const translate = (key, ...args) => t(key, lang(), ...args)
  translate.lang = lang
  return translate
}

/**
 * Returns a reactive `t()` bound to the current language from SettingsContext.
 *
 * Usage:
 *   const t = useT()
 *   <span>{t('topbar.launch')}</span>
 */
export function useT() {
  return makeT(useContext(SettingsContext))
}

/**
 * A non-reactive `t()` bound to a specific language string.
 * For use outside components (e.g. in constants or tests).
 */
export function tFor(lang) {
  return (key, ...args) => t(key, lang, ...args)
}

// ── Contract values in words ───────────────────────────────────────────────
//
// The translated twins of lib/format.js's labels. English output is the same
// string format.js gives — i18n.test.js holds the two equal.

/**
 * An enum value in words: `enumLabel(t, 'stage', 'triaged')`. Null, and a
 * value this console has no word for, render as `fallback` (a dash by
 * default), the way format.js's lookup tables do.
 */
export function enumLabel(t, group, value, fallback = DASH) {
  if (value == null) return fallback
  const key = `${group}.${value}`
  return hasKey(key) ? t(key) : fallback
}

/** CAMARA's reachability, with "(assumed — lookup failed)" when it was assumed. */
export function reachabilityText(t, device) {
  if (!device || !device.reachability_status) return DASH
  const status = device.reachability_status
  const words = enumLabel(t, 'reach', status, status.replace(/_/g, ' '))
  return device.reachability_assumed ? t('reach.assumed', words) : words
}

/** Severity worded for its disaster type: only an earthquake has an "M". */
export function severityText(t, type, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
  const key = hasKey(`severity.${type}`) ? `severity.${type}` : 'severity.other'
  return t(key, value.toFixed(1))
}

/** Relative time from a millisecond timestamp, as format.js's ago(). */
export function agoText(t, ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return DASH
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 2) return t('time.justNow')
  if (s < 60) return t('time.seconds', s)
  const m = Math.floor(s / 60)
  if (m < 60) return t('time.minutes', m, s % 60)
  const h = Math.floor(m / 60)
  return t('time.hours', h, m % 60)
}

// Exposed for the dictionary test: every English key has an Arabic one.
export const _DICTIONARIES = DICTIONARIES
