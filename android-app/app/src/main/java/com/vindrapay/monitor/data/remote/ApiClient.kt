package com.vindrapay.monitor.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Response
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

interface VindraApi {

    @GET("healthz")
    suspend fun healthz(): Response<ResponseBody>

    @POST("device/v1/heartbeat")
    suspend fun heartbeat(@Body body: HeartbeatRequest): Response<ApiResponse<HeartbeatData>>

    @POST("device/v1/messages")
    suspend fun sendMessages(@Body body: MessagesRequest): Response<ApiResponse<MessagesData>>
}

object NetworkConfig {
    @Volatile
    var baseUrl: String = ""
}

@OptIn(ExperimentalSerializationApi::class)
class ApiClient(private val tokenProvider: () -> String?) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(BaseUrlInterceptor())
        .addInterceptor(AuthInterceptor(tokenProvider))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    val api: VindraApi by lazy {
        Retrofit.Builder()
            .baseUrl(PLACEHOLDER_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(VindraApi::class.java)
    }

    private class BaseUrlInterceptor : Interceptor {

        override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
            val configured = NetworkConfig.baseUrl.toHttpUrlOrNull() ?: return chain.proceed(chain.request())
            val original = chain.request()
            val rewritten = original.newBuilder()
                .url(configured.newBuilder().encodedPath(original.url.encodedPath).build())
                .build()
            return chain.proceed(rewritten)
        }
    }

    private class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {

        override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
            val token = tokenProvider()
            val request = if (token != null) {
                chain.request().newBuilder().header("Authorization", "Bearer $token").build()
            } else {
                chain.request()
            }
            return chain.proceed(request)
        }
    }

    companion object {
        private const val PLACEHOLDER_BASE_URL = "http://localhost/"
    }
}
