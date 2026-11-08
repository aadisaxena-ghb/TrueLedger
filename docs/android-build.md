# TrueLedger Android Build Guide: SMS & Notification Capture

This document outlines how to package TrueLedger into an Android application with background SMS and notification capture, reusing `js/parser.js` directly on-device without any server or cloud dependencies.

---

## 1. Architectural Overview

```
+--------------------------------------------------------------+
|                    Android OS Device                         |
|                                                              |
|  +-------------------------+    +-------------------------+  |
|  |  BroadcastReceiver      |    | NotificationListener    |  |
|  |  (Telephony SMS Intent) |    | Service (GPay, PhonePe) |  |
|  +------------+------------+    +------------+------------+  |
|               |                              |               |
|               +--------------+---------------+               |
|                              |                               |
|                              v                               |
|             +---------------------------------+              |
|             |  On-Device Filter & Parser      |              |
|             |  (Evaluates js/parser.js via    |              |
|             |   Android WebView / QuickJS)    |              |
|             +----------------+----------------+              |
|                              |                               |
|                              v                               |
|             +---------------------------------+              |
|             |   TrueLedger Review Queue       |              |
|             |   (Stored in localStorage / DB) |              |
|             +----------------+----------------+              |
|                              |                               |
|                              v                               |
|             +---------------------------------+              |
|             |   TrueLedger Web UI             |              |
|             |   (User Confirms / Edits)       |              |
|             +---------------------------------+              |
+--------------------------------------------------------------+
```

### Key Principles
1. **100% On-Device Privacy:** Financial messages are processed locally. No external APIs or third-party cloud servers are ever touched.
2. **Reuse `js/parser.js`:** The same parser used in the web app runs unchanged inside Android (via QuickJS, JavaScriptCore, or WebView `evaluateJavascript`).
3. **Staging Review Queue:** Intercepted events are deposited into the **Review Queue** (`state.reviewQueue`). The user reviews and accepts each item before it is committed to the ledger.

---

## 2. Android Manifest & Permissions

Add the required permissions in `app/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.trueledger.app">

    <!-- SMS Capture Permission -->
    <uses-permission android:name="android.permission.RECEIVE_SMS" />
    <uses-permission android:name="android.permission.READ_SMS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="TrueLedger"
        android:theme="@style/Theme.TrueLedger">

        <!-- SMS Broadcast Receiver -->
        <receiver
            android:name=".SmsReceiver"
            android:exported="true"
            android:permission="android.permission.BROADCAST_SMS">
            <intent-filter android:priority="999">
                <action android:name="android.provider.Telephony.SMS_RECEIVED" />
            </intent-filter>
        </receiver>

        <!-- Notification Listener Service for GPay, PhonePe, Paytm, CRED -->
        <service
            android:name=".FinancialNotificationListener"
            android:label="TrueLedger Notification Service"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

---

## 3. SMS BroadcastReceiver Implementation (Kotlin)

```kotlin
package com.trueledger.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsMessage

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val sender = sms.originatingAddress ?: ""
                val body = sms.messageBody ?: ""

                // Filter for bank/financial sender IDs (e.g., VK-HDFCBK, AXISBK, SBINB)
                if (isFinancialSender(sender) || isFinancialMessage(body)) {
                    ParserBridge.processMessage(context, body)
                }
            }
        }
    }

    private fun isFinancialSender(sender: String): Boolean {
        val financialKeywords = listOf("HDFC", "SBI", "ICICI", "AXIS", "KOTAK", "PNB", "BOB", "CANBNK", "UNION", "PAYTM")
        return financialKeywords.any { sender.contains(it, ignoreCase = true) }
    }

    private fun isFinancialMessage(body: String): Boolean {
        val keywords = listOf("debited", "credited", "spent", "INR", "Rs.", "₹", "UPI", "Ref No")
        return keywords.any { body.contains(it, ignoreCase = true) }
    }
}
```

---

## 4. Notification Listener Service (For UPI Apps)

Captures push notifications from Google Pay (`com.google.android.apps.nbu.paisa.user`), PhonePe (`com.phonepe.app`), Paytm (`net.one97.paytm`), and CRED (`com.dreamplug.androidapp`):

```kotlin
package com.trueledger.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class FinancialNotificationListener : NotificationListenerService() {

    private val supportedPackages = setOf(
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",                       // PhonePe
        "net.one97.paytm",                       // Paytm
        "com.dreamplug.androidapp"               // CRED
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (supportedPackages.contains(sbn.packageName)) {
            val extras = sbn.notification.extras
            val title = extras.getString("android.title") ?: ""
            val text = extras.getCharSequence("android.text")?.toString() ?: ""
            val fullContent = "$title $text"

            if (fullContent.contains("paid", ignoreCase = true) ||
                fullContent.contains("received", ignoreCase = true) ||
                fullContent.contains("Rs", ignoreCase = true) ||
                fullContent.contains("₹")) {
                ParserBridge.processMessage(applicationContext, fullContent)
            }
        }
    }
}
```

---

## 5. JavaScript Parser Bridge

You can run `js/parser.js` inside Android using **QuickJS Android** or an off-screen WebView:

```kotlin
package com.trueledger.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.WebView

object ParserBridge {
    private var webView: WebView? = null

    fun init(context: Context) {
        if (webView == null) {
            Handler(Looper.getMainLooper()).post {
                webView = WebView(context).apply {
                    settings.javaScriptEnabled = true
                    // Load TrueLedger assets
                    loadUrl("file:///android_asset/www/index.html")
                }
            }
        }
    }

    fun processMessage(context: Context, rawText: String) {
        Handler(Looper.getMainLooper()).post {
            val escaped = rawText.replace("'", "\\'").replace("\n", " ")
            val jsCode = "if (window.EF && window.EF.Store) { window.EF.Store.addToReviewQueue('$escaped'); }"
            webView?.evaluateJavascript(jsCode, null)
        }
    }
}
```

---

## 6. Packaging Options

1. **Capacitor / Cordova:**
   - Run `npx cap init TrueLedger com.trueledger.app`
   - Point `webDir` to `expense-tracker`
   - Add `@capacitor-community/sms-listener` or use the custom native receiver above.
2. **Standalone WebView WebAPK (PWA):**
   - The user can tap **Install App** right from TrueLedger in Chrome to get an instant standalone WebAPK.
