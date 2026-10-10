// Подключает RuStore Pay SDK (Android) при сборке: репозиторий и зависимость, регистрация пакета,
// обработка возврата из банковского приложения по deeplink, id приложения и схема в манифесте.
// Значения из app.json: { consoleAppId } — id приложения из RuStore Console (до публикации можно пусто).
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withMainApplication,
  withMainActivity,
  withAndroidManifest,
} = require('@expo/config-plugins');

const REPO = "maven { url 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed' }";
const DEP = 'implementation("ru.rustore.sdk-wrapper.react-native:pay:11.1.0")';

function addRepo(src) {
  if (src.includes('maven-rustore-exposed')) return src;
  return src.replace(/allprojects\s*\{\s*repositories\s*\{/, (m) => `${m}\n    ${REPO}`);
}

function addDep(src) {
  if (src.includes('ru.rustore.sdk-wrapper')) return src;
  return src.replace(/^dependencies\s*\{/m, (m) => `${m}\n    ${DEP}`);
}

function addPackage(src) {
  if (src.includes('RuStoreReactPayPackage')) return src;
  const withImport = src.replace(
    'import com.facebook.react.ReactPackage\n',
    'import com.facebook.react.ReactPackage\nimport ru.rustore.react.pay.RuStoreReactPayPackage\n',
  );
  return withImport.replace(/\/\/ add\(MyReactNativePackage\(\)\)/, 'add(RuStoreReactPayPackage())');
}

function addActivityHooks(src) {
  if (src.includes('RuStoreReactPayModule')) return src;
  let out = src.replace('import android.os.Bundle\n', 'import android.content.Intent\nimport android.os.Bundle\nimport ru.rustore.react.pay.RuStoreReactPayModule\n');
  out = out.replace('super.onCreate(null)', 'super.onCreate(null)\n    intent?.let { RuStoreReactPayModule.processIntent(it) }');
  out = out.replace(
    '  override fun getMainComponentName',
    `  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    RuStoreReactPayModule.processIntent(intent)
  }

  override fun getMainComponentName`,
  );
  return out;
}

const withRuStorePay = (config, props = {}) => {
  const consoleAppId = props.consoleAppId || '';
  const scheme = props.scheme || `${config.android?.package || 'app'}.rustore`;

  config = withProjectBuildGradle(config, (c) => {
    c.modResults.contents = addRepo(c.modResults.contents);
    return c;
  });
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = addDep(c.modResults.contents);
    return c;
  });
  config = withMainApplication(config, (c) => {
    c.modResults.contents = addPackage(c.modResults.contents);
    return c;
  });
  config = withMainActivity(config, (c) => {
    c.modResults.contents = addActivityHooks(c.modResults.contents);
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app['meta-data'] = (app['meta-data'] || []).filter((m) => !['console_app_id_value', 'sdk_pay_scheme_value'].includes(m.$['android:name']));
    app['meta-data'].push(
      { $: { 'android:name': 'console_app_id_value', 'android:value': consoleAppId } },
      { $: { 'android:name': 'sdk_pay_scheme_value', 'android:value': scheme } },
    );
    const main = (app.activity || []).find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main['intent-filter'] = main['intent-filter'] || [];
      const exists = main['intent-filter'].some((f) => (f.data || []).some((d) => d.$['android:scheme'] === scheme));
      if (!exists) {
        main['intent-filter'].push({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
          data: [{ $: { 'android:scheme': scheme } }],
        });
      }
    }
    return c;
  });
  return config;
};

module.exports = withRuStorePay;
