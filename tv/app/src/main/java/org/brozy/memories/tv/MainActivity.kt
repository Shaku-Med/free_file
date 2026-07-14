package org.brozy.memories.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import org.brozy.memories.tv.ui.MemoriesTvApp
import org.brozy.memories.tv.ui.theme.MemoriesTvTheme

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalTvMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MemoriesTvTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MemoriesTvApp()
                }
            }
        }
    }
}
