# AquaDiagnose: Billing-Diagnose und Inbetriebnahme

## Nachgewiesener Stand vom 11.11.2026

- Repository und GitHub-Production-Deployment standen auf Commit `191a6fa`.
- `https://aquarium-wasserwerte-rechner.vercel.app/.well-known/assetlinks.json`
  war über Safari öffentlich erreichbar und enthielt nur den Fingerabdruck
  `12:68:02:E2:91:89:4D:EB:DF:65:5B:AA:10:B6:05:C2:77:2B:8B:9C:51:57:33:A2:C0:15:E8:A6:E2:70:AF:59`.
- Die per USB ausgelesene App `com.schwarzermarco14.aquadiagnose2`,
  Version `2.0.0.0` (`versionCode=2`), war durch `com.android.vending` installiert.
- `apksigner verify --print-certs` bestätigte an ihrer APK den SHA-256-Fingerabdruck
  `9A:13:E5:C4:BE:78:05:5A:D9:7D:78:AF:27:48:C2:23:9F:17:A3:26:1C:D0:D0:70:5A:0C:A0:17:81:72:83:4C`.
  Dieser fehlte in der produktiven Domain-Verknüpfung. `pm get-app-links` meldete
  für die Vercel-Domain den Fehlerstatus `1024`, keine erfolgreiche Verifizierung.
- Die APK enthält bereits Billing Library `8.3.0`, `PaymentActivity`,
  `PaymentService`, `DelegationService` und die Berechtigung `com.android.vending.BILLING`.
  Die Ressourcen nennen `PWABuilder` als Generator und die erwartete Vercel-Domain als Start-URL.
  Eine fehlende native Billing-Integration ist damit nicht der bestätigte Fehler.
- Im JavaScript wurde `getDigitalGoodsService()` mit der Store-Detailseite statt
  `https://play.google.com/billing` aufgerufen. Fehler leiteten auf `market://` um.
  Nach einem Kauf wurde Premium auf `false` gesetzt und trotzdem Erfolg gemeldet.

## Verursachende Commits

Alle Zeiten sind Ortszeit Berlin am 08.11.2026.

- `8d2a037` (09:19:32) führte den Digital-Goods-Kaufablauf zunächst mit der richtigen
  Dienstadresse `https://play.google.com/billing` und `isPremiumUser = true` nach dem Kauf ein.
  Serverseitige Prüfung und Bestätigung fehlten bereits dort.
- `f8d15dc` (09:50:30) ersetzte die richtige Dienstadresse durch die App-Store-Detailseite.
  Derselbe Commit setzte nach dem Kauf `isPremiumUser` und dessen gespeicherten Wert
  auf `false`, ließ aber die Erfolgsmeldung stehen. Zudem wurde bei jedem Fehler
  außer einem Kaufabbruch auf die Store-Seite umgeleitet.
- `25d4650` (10:08:55) trug die heutige Paket-ID mit genau dem Zertifikat ein,
  das jetzt an der APK auf dem Telefon gemessen wurde (`9A:13:…:83:4C`).
- `fb1cb65` (12:00:35) entfernte dieses passende Zertifikat und ersetzte es durch einen
  nur 20 Byte langen SHA-1-Fingerabdruck (`7B:AC:…:C6:EC`) im SHA-256-Feld.
  Der Commit-Titel nennt nur das Entfernen der Login-Credentials-Relation;
  die entscheidende Änderung am Zertifikat steht zusätzlich im Diff.
- `75e3adb`, `eba8ef8` und `7e225c2` wechselten danach Fingerabdruck bzw. Feldnamen,
  ohne das passende Zertifikat wiederherzustellen.
- `191a6fa` (14:47:49) stellte einen formal gültigen SHA-256-Wert ein (`12:68:…:AF:59`),
  der aber weiterhin nicht zur untersuchten APK passt.

Ein einzelner pauschaler Rollback behebt damit nicht alle Fehler: JavaScript und
Domain-Verknüpfung wurden in verschiedenen Commits beschädigt.

## Lokale Korrektur

Die Domain-Datei enthält zusätzlich die aus der installierten APK bestätigte
Signatur. Die bisherige Signatur bleibt erhalten; ihre Herkunft ist noch offen.
Vor dem Produktionsrelease beide Signaturen mit den tatsächlich vorgesehenen
App-Signatur- und ggf. internen App-Sharing-Zertifikaten in der Play Console abgleichen.

Der Kaufablauf prüft vorhandene Käufe, verwendet die korrekte Billing-Adresse und
zeigt Fehler ohne Store-Weiterleitung. Premium wird nur nach serverseitiger
Prüfung und Kaufbestätigung freigeschaltet. Vorhandene Käufe werden beim App-Start
erneut geprüft; ein manipulierbares `localStorage`-Flag gilt nicht als Kaufbeleg.
Aquarien und Tagebuchdaten bleiben lokal erhalten.

`api/google-play.js` ist eine Vercel Node.js Function. Sie prüft den Kaufstatus und
die Produkt-ID über Google Play und bestätigt neue Käufe. Das Produkt wird nicht
konsumiert, damit sich die Freischaltung wiederherstellen lässt.
Der Endpunkt setzt **einen dauerhaften Einmalkauf** `aquadiagnose_premium` voraus.
Für ein Abonnement ist die Verifizierung entsprechend anzupassen.

## Noch erforderliche Einrichtung

1. In der Google Cloud Console ein bestehendes oder neues Projekt auswählen und
   unter **APIs & Dienste → Bibliothek** die **Google Play Android Developer API**
   aktivieren. Unter **IAM & Verwaltung → Dienstkonten** einen Service-Account
   anlegen, zum Beispiel `aquadiagnose-billing`. Die Service-Account-E-Mail kopieren.
   Eine Cloud-Owner-/Editor-Rolle für den Service-Account ist dafür nicht erforderlich;
   die App-Berechtigungen werden in der Play Console vergeben.
2. In der **Google Play Console → Nutzer und Berechtigungen → Neue Nutzer einladen**
   die Service-Account-E-Mail hinzufügen. Zugriff auf AquaDiagnose
   (`com.schwarzermarco14.aquadiagnose2`) gewähren und folgende von Google für Billing
   verlangten Rechte aktivieren (englische Originalbezeichnungen):
   **View financial data, orders, and cancellation survey responses** sowie
   **Manage orders and subscriptions**. Einladung abschließen.
3. In der Cloud Console das Dienstkonto öffnen und unter
   **Schlüssel → Schlüssel hinzufügen → Neuen Schlüssel erstellen → JSON**
   einen Schlüssel herunterladen. In Vercel das AquaDiagnose-Projekt öffnen und
   unter **Environment Variables** folgenden Eintrag anlegen:

   | Einstellung | Wert |
   | --- | --- |
   | Name | `GOOGLE_PLAY_SERVICE_ACCOUNT` |
   | Value | Vollständiger Inhalt der heruntergeladenen JSON-Datei, einschließlich `{` und `}` |
   | Environment | `Production`; für einen gezielten PR-Test zusätzlich die passende Preview-Umgebung |

   Den JSON-Inhalt direkt einfügen, ohne zusätzliche äußere Anführungszeichen oder
   Base64-Kodierung. Die `\n`-Sequenzen innerhalb von `private_key` unverändert lassen.
   Der Schlüssel gehört weder ins HTML, ins Git noch in einen PR-Kommentar.
   Er wird ausschließlich von der Vercel Function gelesen.
4. Änderungen auf Vercel veröffentlichen. Die Function benötigt Node.js 22 und
   `npm install`; das Web-Frontend bleibt statisches HTML.
   Nach dem Anlegen oder Ändern der Umgebungsvariable ein neues Deployment starten
   bzw. unter **Deployments → Redeploy** erneut bereitstellen. Bereits laufende
   Deployments übernehmen geänderte Variablen nicht automatisch.
5. `GET /api/google-play` muss mit HTTP 200 und `{"ready":true}` antworten.
   Dabei werden Google-Zugang und Zugriff auf den Produktkatalog geprüft.
   Ohne erreichbaren Prüfserver startet die App keinen neuen Kauf.
   Nach der produktiven Bereitstellung kann diese URL im Browser geöffnet werden:
   `https://aquarium-wasserwerte-rechner.vercel.app/api/google-play`.
   Die Bereitschaftsprüfung löst keinen Kauf aus und ersetzt noch keinen Test der
   Kaufbestätigung. Bei HTTP 404 fehlt die Function im Deployment; bei HTTP 503
   fehlen Konfiguration, API-/Play-Zugriff oder die Erreichbarkeit von Google.
6. Auf der endgültigen Vercel-Domain die neue `assetlinks.json` prüfen.
   Auf dem verbundenen Telefon die Verifizierung erneut anstoßen:

   ```sh
   adb shell pm verify-app-links --re-verify com.schwarzermarco14.aquadiagnose2
   adb shell pm get-app-links com.schwarzermarco14.aquadiagnose2
   ```

   Die Verifizierung läuft asynchron; anschließend muss die Domain als `verified`
   erscheinen. Die App danach neu öffnen. Auch Chromes TWA-Verifizierung muss
   erfolgreich sein; der Android-App-Link-Status allein ersetzt diesen Test nicht.
7. Mit einem Lizenztester über den internen Play-Test prüfen: Produkt verfügbar,
   Testkauf, Kaufabbruch, ausstehende Zahlung, erneuter App-Start, Wiederherstellung.
   Dabei keine echten Zahlungen auslösen. Ein neues Android-Paket ist für die
   bestätigten Web-/Domain-Korrekturen zunächst nicht erforderlich.

## Prüfung

`npm test` prüft den Web-Ablauf mit simulierten Browser-APIs und die Function mit
simulierten Google-Antworten. Die Tests ersetzen keinen Kauf auf dem Android-Gerät.

Da alle Premium-Funktionen im ausgelieferten HTML liegen, kann ein technisch
versierter Nutzer die Oberfläche lokal manipulieren. Die serverseitige Kaufprüfung
ist keine Zugangssperre für bereits ausgelieferten JavaScript-Code. Beim späteren
Einführen von Konten oder geschützten Serverfunktionen müssen Käufe an das jeweilige
Konto gebunden und Berechtigungen für jede Serveraktion erneut geprüft werden.

## Quellen

- [Google: Play Billing in Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing)
- [Google: Kaufstatus prüfen](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2)
- [Google: Käufe bestätigen](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge)
- [Google: Produktkatalog prüfen](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/get)
- [Google: API-Zugang und erforderliche Play-Berechtigungen](https://developers.google.com/android-publisher/getting_started)
- [Google: JSON-Schlüssel erstellen](https://docs.cloud.google.com/iam/docs/keys-create-delete)
- [Vercel: Umgebungsvariablen einrichten und neu bereitstellen](https://vercel.com/docs/environment-variables/managing-environment-variables)
