package com.aw1000.control

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class MainActivity : Activity() {

    private val prefsName = "aw1000_control_prefs"
    private val darkStatusBg = Color.parseColor("#0B1120")
    private val cardBg = Color.parseColor("#131C31")
    private val inputBg = Color.parseColor("#1E293B")
    private val accentBlue = Color.parseColor("#2F7BFF")
    private val accentGreen = Color.parseColor("#10B981")
    private val accentPink = Color.parseColor("#FF3B5C")
    private val textWhite = Color.parseColor("#F8FAFC")
    private val textMuted = Color.parseColor("#94A3B8")

    private lateinit var rootLayout: LinearLayout
    private lateinit var topBarLabel: TextView
    private lateinit var contentFrame: FrameLayout
    private lateinit var webView: WebView
    private lateinit var landingView: ScrollView
    private lateinit var fallbackView: LinearLayout

    private lateinit var lanInput: EditText
    private lateinit var vpnInput: EditText
    private lateinit var fallbackTitle: TextView
    private lateinit var fallbackSub: TextView
    private lateinit var fallbackQuickSwitchBtn: Button

    private val allowedHosts: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())
    private var activeHost: String = "192.168.1.1"
    private var mainFrameFailed: Boolean = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        val savedLan = cleanHost(prefs.getString("lan_host", "192.168.1.1") ?: "192.168.1.1").ifEmpty { "192.168.1.1" }
        val savedVpn = cleanHost(prefs.getString("vpn_host", "") ?: "")
        activeHost = cleanHost(prefs.getString("active_host", savedLan) ?: savedLan).ifEmpty { savedLan }
        val isConfigured = prefs.getBoolean("configured", false)

        allowedHosts.add("192.168.1.1")
        allowedHosts.add(savedLan)
        if (savedVpn.isNotEmpty()) allowedHosts.add(savedVpn)
        allowedHosts.add(activeHost)

        buildUiHierarchy(savedLan, savedVpn)
        setContentView(rootLayout)
        configureSystemBars()
        configureWebView()

        if (!isConfigured) {
            showLandingScreen()
        } else {
            loadRouterUrl(activeHost)
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun roundedBg(fillColor: Int, radiusDp: Int, strokeColor: Int = 0, strokeWidthDp: Int = 0): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radiusDp).toFloat()
            setColor(fillColor)
            if (strokeWidthDp > 0) {
                setStroke(dp(strokeWidthDp), strokeColor)
            }
        }
    }

    private fun buildUiHierarchy(savedLan: String, savedVpn: String) {
        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(darkStatusBg)
            fitsSystemWindows = true
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Sleek compact native top bar (#0B1120) so user can always switch IP or retry in 1 tap
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(darkStatusBg)
            setPadding(dp(12), dp(6), dp(12), dp(6))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        topBarLabel = TextView(this).apply {
            text = "AW1000 · $activeHost"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val reloadBtn = TextView(this).apply {
            text = "↻ Reload"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(inputBg, 8)
            setPadding(dp(10), dp(5), dp(10), dp(5))
            setOnClickListener {
                loadRouterUrl(activeHost)
            }
        }

        val gearBtn = TextView(this).apply {
            text = "⚙ Switch IP"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(accentBlue, 8)
            setPadding(dp(10), dp(5), dp(10), dp(5))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                leftMargin = dp(8)
            }
            setOnClickListener {
                showLandingScreen()
            }
        }

        topBar.addView(topBarLabel)
        topBar.addView(reloadBtn)
        topBar.addView(gearBtn)
        rootLayout.addView(topBar)

        contentFrame = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        landingView = buildLandingView(savedLan, savedVpn)
        fallbackView = buildFallbackView()

        contentFrame.addView(webView)
        contentFrame.addView(fallbackView)
        contentFrame.addView(landingView)
        rootLayout.addView(contentFrame)
    }

    private fun buildLandingView(savedLan: String, savedVpn: String): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(darkStatusBg)
            isFillViewport = true
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg(cardBg, 18, Color.parseColor("#26344E"), 1)
            setPadding(dp(20), dp(22), dp(20), dp(22))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val title = TextView(this).apply {
            text = "AW1000 Router Connection"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
            typeface = Typeface.DEFAULT_BOLD
        }

        val subtitle = TextView(this).apply {
            text = "Enter your AW1000 Ultra router IP or VPN hostname. Self-signed HTTPS is handled automatically for your saved router addresses."
            setTextColor(textMuted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, dp(6), 0, dp(16))
        }

        val lanLabel = TextView(this).apply {
            text = "Primary Local Wi-Fi / LAN IP"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
        }

        lanInput = EditText(this).apply {
            setText(savedLan)
            hint = "192.168.1.1"
            setTextColor(textWhite)
            setHintTextColor(textMuted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = roundedBg(inputBg, 12, Color.parseColor("#334155"), 1)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(6)
                bottomMargin = dp(10)
            }
        }

        val connectLanBtn = Button(this).apply {
            text = "Connect via Local Wi-Fi (LAN) →"
            setTextColor(Color.parseColor("#042619"))
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBg(accentGreen, 12)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(18)
            }
            setOnClickListener {
                val lan = cleanHost(lanInput.text.toString()).ifEmpty { "192.168.1.1" }
                val vpn = cleanHost(vpnInput.text.toString())
                saveProfilesAndConnect(lan, vpn, lan)
            }
        }

        val vpnLabel = TextView(this).apply {
            text = "Remote VPN IP or Domain (NetBird / Tailscale / WireGuard)"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
        }

        vpnInput = EditText(this).apply {
            setText(savedVpn)
            hint = "e.g. 10.6.x.x, 100.x.x.x, or router.netbird.cloud"
            setTextColor(textWhite)
            setHintTextColor(textMuted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = roundedBg(inputBg, 12, Color.parseColor("#334155"), 1)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(6)
                bottomMargin = dp(10)
            }
        }

        val connectVpnBtn = Button(this).apply {
            text = "Connect via Remote VPN →"
            setTextColor(textWhite)
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBg(accentBlue, 12)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(12)
            }
            setOnClickListener {
                val lan = cleanHost(lanInput.text.toString()).ifEmpty { "192.168.1.1" }
                val vpn = cleanHost(vpnInput.text.toString())
                if (vpn.isEmpty()) {
                    Toast.makeText(this@MainActivity, "Enter your Remote VPN IP or Domain first", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                saveProfilesAndConnect(lan, vpn, vpn)
            }
        }

        val cancelBtn = Button(this).apply {
            text = "Back to Current View"
            setTextColor(textMuted)
            isAllCaps = false
            background = roundedBg(inputBg, 12)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                landingView.visibility = View.GONE
            }
        }

        card.addView(title)
        card.addView(subtitle)
        card.addView(lanLabel)
        card.addView(lanInput)
        card.addView(connectLanBtn)
        card.addView(vpnLabel)
        card.addView(vpnInput)
        card.addView(connectVpnBtn)
        card.addView(cancelBtn)

        container.addView(card)
        scroll.addView(container)
        return scroll
    }

    private fun buildFallbackView(): LinearLayout {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(darkStatusBg)
            setPadding(dp(20), dp(24), dp(20), dp(24))
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg(cardBg, 18, accentPink, 1)
            setPadding(dp(20), dp(22), dp(20), dp(22))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        fallbackTitle = TextView(this).apply {
            text = "Router Unreachable"
            setTextColor(textWhite)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        }

        fallbackSub = TextView(this).apply {
            text = "Could not load https://192.168.1.1/app/. Check that Wi-Fi or your VPN is connected."
            setTextColor(textMuted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            setPadding(0, dp(8), 0, dp(18))
        }

        val retryBtn = Button(this).apply {
            text = "Retry Connection"
            setTextColor(textWhite)
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBg(accentBlue, 12)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(10)
            }
            setOnClickListener {
                loadRouterUrl(activeHost)
            }
        }

        fallbackQuickSwitchBtn = Button(this).apply {
            text = "Switch to Local Wi-Fi (192.168.1.1)"
            setTextColor(Color.parseColor("#042619"))
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBg(accentGreen, 12)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(10)
            }
        }

        val editIpBtn = Button(this).apply {
            text = "Switch / Edit Router IP"
            setTextColor(textWhite)
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBg(inputBg, 12, Color.parseColor("#334155"), 1)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                showLandingScreen()
            }
        }

        card.addView(fallbackTitle)
        card.addView(fallbackSub)
        card.addView(retryBtn)
        card.addView(fallbackQuickSwitchBtn)
        card.addView(editIpBtn)
        outer.addView(card)
        return outer
    }

    private fun configureSystemBars() {
        runOnUiThread {
            val win = window ?: return@runOnUiThread
            val decor = win.peekDecorView() ?: return@runOnUiThread
            decor.post {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        win.setDecorFitsSystemWindows(true)
                    }
                    @Suppress("DEPRECATION")
                    win.statusBarColor = darkStatusBg
                    @Suppress("DEPRECATION")
                    win.navigationBarColor = darkStatusBg

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        val controller = decor.windowInsetsController
                        val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                        // Dark #0B1120 status bar uses white system icons (appearance = 0)
                        controller?.setSystemBarsAppearance(0, mask)
                    } else {
                        @Suppress("DEPRECATION")
                        val flags = decor.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                        @Suppress("DEPRECATION")
                        decor.systemUiVisibility = flags
                    }
                } catch (_: Throwable) {
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setSupportZoom(false)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(NativeBridge(), "AW1000Native")
        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url ?: return false
                val host = (url.host ?: "").lowercase()
                if (isTrustedRouterHost(host)) {
                    return false
                }
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (_: Exception) {
                    true
                }
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                val errUrl = error.url ?: ""
                val host = try {
                    (Uri.parse(errUrl).host ?: "").lowercase().substringBefore(":")
                } catch (_: Exception) {
                    ""
                }
                val activeBare = activeHost.lowercase().substringBefore(":")
                if (host.isEmpty() || host == activeBare || isTrustedRouterHost(host) || isTrustedRouterHost(activeBare)) {
                    handler.proceed()
                } else {
                    handler.cancel()
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        error.description?.toString() ?: "Connection failed"
                    } else {
                        "Connection failed"
                    }
                    showFallbackCard(desc)
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!mainFrameFailed) {
                    fallbackView.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                }
            }
        }

        webView.setDownloadListener(DownloadListener { url, _, contentDisposition, mimeType, _ ->
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                .ifBlank { "backup-aw1000-${System.currentTimeMillis()}.tar.gz" }
            downloadRouterBackup(url, fileName)
        })
    }

    private fun cleanHost(raw: String): String {
        return raw.trim()
            .lowercase()
            .replace(Regex("^https?://"), "")
            .substringBefore("/")
            .substringBefore("?")
            .trim()
    }

    private fun buildHttpsAppUrl(host: String): String {
        val target = cleanHost(host).ifEmpty { "192.168.1.1" }
        return "https://$target/app/"
    }

    private fun saveProfilesAndConnect(lan: String, vpn: String, target: String) {
        val cleanLan = cleanHost(lan).ifEmpty { "192.168.1.1" }
        val cleanVpn = cleanHost(vpn)
        val cleanTarget = cleanHost(target).ifEmpty { cleanLan }

        allowedHosts.add(cleanLan.substringBefore(":"))
        if (cleanVpn.isNotEmpty()) allowedHosts.add(cleanVpn.substringBefore(":"))
        allowedHosts.add(cleanTarget.substringBefore(":"))

        getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .edit()
            .putString("lan_host", cleanLan)
            .putString("vpn_host", cleanVpn)
            .putString("active_host", cleanTarget)
            .putBoolean("configured", true)
            .apply()

        loadRouterUrl(cleanTarget)
    }

    private fun loadRouterUrl(host: String) {
        val target = cleanHost(host).ifEmpty { "192.168.1.1" }
        activeHost = target
        allowedHosts.add(target.substringBefore(":"))

        getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .edit()
            .putString("active_host", target)
            .putBoolean("configured", true)
            .apply()

        runOnUiThread {
            mainFrameFailed = false
            topBarLabel.text = "AW1000 · $target"
            landingView.visibility = View.GONE
            fallbackView.visibility = View.GONE
            webView.visibility = View.VISIBLE
            webView.stopLoading()
            webView.loadUrl(buildHttpsAppUrl(target))
        }
    }

    private fun showLandingScreen() {
        runOnUiThread {
            val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            lanInput.setText(prefs.getString("lan_host", "192.168.1.1") ?: "192.168.1.1")
            vpnInput.setText(prefs.getString("vpn_host", "") ?: "")
            landingView.visibility = View.VISIBLE
        }
    }

    private fun showFallbackCard(reason: String) {
        runOnUiThread {
            val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val savedLan = cleanHost(prefs.getString("lan_host", "192.168.1.1") ?: "192.168.1.1").ifEmpty { "192.168.1.1" }
            val savedVpn = cleanHost(prefs.getString("vpn_host", "") ?: "")

            fallbackTitle.text = "Cannot Reach $activeHost"
            fallbackSub.text = "Failed to load https://$activeHost/app/ ($reason).\n\nIf you turned off your VPN while on home Wi-Fi, switch to Local Wi-Fi ($savedLan) below."

            val alternateHost = if (activeHost == savedLan && savedVpn.isNotEmpty()) {
                savedVpn
            } else if (activeHost != savedLan) {
                savedLan
            } else {
                ""
            }

            if (alternateHost.isNotEmpty()) {
                fallbackQuickSwitchBtn.visibility = View.VISIBLE
                fallbackQuickSwitchBtn.text = "Switch to $alternateHost →"
                fallbackQuickSwitchBtn.setOnClickListener {
                    loadRouterUrl(alternateHost)
                }
            } else {
                fallbackQuickSwitchBtn.visibility = View.GONE
            }

            webView.visibility = View.INVISIBLE
            landingView.visibility = View.GONE
            fallbackView.visibility = View.VISIBLE
        }
    }

    private fun isTrustedRouterHost(rawHost: String): Boolean {
        val h = rawHost.trim().lowercase().substringBefore(":")
        if (h.isEmpty()) return false
        if (allowedHosts.contains(h)) return true

        if (h.startsWith("192.168.") || h.startsWith("10.") || h.endsWith(".lan") || h.endsWith(".local")) {
            return true
        }
        if (Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.\\d{1,3}\\.\\d{1,3}$").matches(h)) {
            return true
        }
        if (h.endsWith(".ts.net") || h.endsWith(".netbird.cloud") || h.endsWith(".netbird.io")) {
            return true
        }
        val tsMatch = Regex("^100\\.(\\d{1,3})\\.\\d{1,3}\\.\\d{1,3}$").matchEntire(h)
        if (tsMatch != null) {
            val secondOctet = tsMatch.groupValues[1].toIntOrNull() ?: 0
            if (secondOctet in 64..127) return true
        }
        return false
    }

    private fun triggerVibration(durationMs: Long) {
        try {
            val ms = durationMs.coerceIn(10L, 400L)
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {
        }
    }

    private fun downloadRouterBackup(urlStr: String, fileName: String) {
        val host = try {
            (Uri.parse(urlStr).host ?: "").lowercase()
        } catch (_: Exception) {
            ""
        }
        if (!isTrustedRouterHost(host)) {
            Toast.makeText(this, "Blocked download from untrusted host", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(this, "Downloading $fileName to Downloads...", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                val url = URL(urlStr)
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10000
                    readTimeout = 30000
                    if (this is HttpsURLConnection && isTrustedRouterHost(url.host ?: "")) {
                        val trustOneHost = arrayOf<TrustManager>(
                            @SuppressLint("CustomX509TrustManager")
                            object : X509TrustManager {
                                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
                                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                            }
                        )
                        val sc = SSLContext.getInstance("TLS")
                        sc.init(null, trustOneHost, SecureRandom())
                        sslSocketFactory = sc.socketFactory
                        hostnameVerifier = HostnameVerifier { h, _ -> isTrustedRouterHost(h) }
                    }
                }

                conn.inputStream.use { input ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                            put(MediaStore.Downloads.MIME_TYPE, "application/gzip")
                            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        }
                        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        if (uri != null) {
                            contentResolver.openOutputStream(uri)?.use { out ->
                                input.copyTo(out)
                            }
                        }
                    } else {
                        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        dir.mkdirs()
                        val outFile = File(dir, fileName)
                        FileOutputStream(outFile).use { out ->
                            input.copyTo(out)
                        }
                    }
                }

                runOnUiThread {
                    Toast.makeText(this, "Saved to Downloads/$fileName", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (landingView.visibility == View.VISIBLE) {
                landingView.visibility = View.GONE
                return true
            }
            if (::webView.isInitialized && webView.visibility == View.VISIBLE) {
                webView.evaluateJavascript(
                    "(function(){ return window.__aw1000HandleBackButton ? Boolean(window.__aw1000HandleBackButton()) : false; })()"
                ) { result ->
                    if (result == "true") {
                        // Handled inside PWA
                    } else if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun setAllowedHosts(hostsCsv: String) {
            hostsCsv.split(",").map { cleanHost(it) }.filter { it.isNotEmpty() }.forEach {
                allowedHosts.add(it.substringBefore(":"))
            }
        }

        @JavascriptInterface
        fun vibrate(durationMs: Long) {
            triggerVibration(durationMs)
        }

        @JavascriptInterface
        fun setTheme(isDark: Boolean) {
            // Keep status bar #0B1120 so it never collides with Android clock/battery icons
            configureSystemBars()
        }

        @JavascriptInterface
        fun openConnectionDialog() {
            showLandingScreen()
        }

        @JavascriptInterface
        fun switchRouterHost(host: String) {
            loadRouterUrl(host)
        }
    }
}
