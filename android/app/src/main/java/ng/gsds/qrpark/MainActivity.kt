package ng.gsds.qrpark

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityMainBinding

/** Placeholder screen (Sprint 0). Login and the Entry/Exit modes arrive in Sprint 4. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ActivityMainBinding.inflate(layoutInflater).root)
    }
}
