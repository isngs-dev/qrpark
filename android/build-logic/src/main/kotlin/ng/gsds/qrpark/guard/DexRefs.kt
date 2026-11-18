package ng.gsds.qrpark.guard

// Copied from C:\Dev\qrpark-n86-probe build-logic/src/main/kotlin/ng/gsds/n86probe/guard/DexRefs.kt
// (N86-1, written for this project); only the package differs.

/**
 * Reads one .dex file and lists, for every class it defines, what that
 * class's code refers to: the methods it invokes, the fields it reads or
 * writes, the types it names (new, cast, instanceof, const-class, arrays),
 * the strings it loads, and its superclass and interfaces.
 *
 * Read-only and self-contained (the dex format is public: Android's "Dalvik
 * Executable format" and "Dalvik bytecode" pages). Nothing is executed.
 * Class names are internal names without L and ; ("com/nexgo/oaf/apiv3/APIProxy").
 */
class DexFile(private val b: ByteArray) {

    init {
        require(b.size > 0x70 && String(b, 0, 4, Charsets.ISO_8859_1) == "dex\n") { "not a dex file" }
    }

    private fun u1(o: Int) = b[o].toInt() and 0xff
    private fun u2(o: Int) = u1(o) or (u1(o + 1) shl 8)
    private fun u4(o: Int) = u2(o) or (u2(o + 2) shl 16)

    private val stringIdsSize = u4(0x38)
    private val stringIdsOff = u4(0x3C)
    private val typeIdsOff = u4(0x44)
    private val fieldIdsOff = u4(0x54)
    private val methodIdsOff = u4(0x5C)
    private val classDefsSize = u4(0x60)
    private val classDefsOff = u4(0x64)

    private val strings = arrayOfNulls<String>(stringIdsSize)

    fun string(i: Int): String = strings[i] ?: decodeString(u4(stringIdsOff + 4 * i)).also { strings[i] = it }

    /** A type descriptor as an internal name: "Lcom/x/Y;" -> "com/x/Y"; arrays to their element. */
    fun type(i: Int): String {
        val d = string(u4(typeIdsOff + 4 * i)).trimStart('[')
        return if (d.startsWith("L") && d.endsWith(";")) d.substring(1, d.length - 1) else d
    }

    private fun method(i: Int): Pair<String, String> =
        type(u2(methodIdsOff + 8 * i)) to string(u4(methodIdsOff + 8 * i + 4))

    private fun field(i: Int): Pair<String, String> =
        type(u2(fieldIdsOff + 8 * i)) to string(u4(fieldIdsOff + 8 * i + 4))

    private fun decodeString(off: Int): String {
        var p = off
        while (u1(p) and 0x80 != 0) p++ // the uleb128 length in UTF-16 units
        p++
        val sb = StringBuilder()
        while (true) {
            val a = u1(p++)
            when {
                a == 0 -> return sb.toString()
                a < 0x80 -> sb.append(a.toChar())
                a and 0xE0 == 0xC0 -> sb.append((((a and 0x1F) shl 6) or (u1(p++) and 0x3F)).toChar())
                else -> {
                    val c = ((a and 0x0F) shl 12) or ((u1(p) and 0x3F) shl 6) or (u1(p + 1) and 0x3F)
                    p += 2
                    sb.append(c.toChar())
                }
            }
        }
    }

    /** Every class defined here, with what its code refers to. */
    fun classes(): List<DexClass> = (0 until classDefsSize).map { i ->
        val base = classDefsOff + 32 * i
        val name = type(u4(base))
        val refs = mutableSetOf<Ref>()
        val superIdx = u4(base + 8)
        if (superIdx != -1) refs += Ref(RefKind.SUPER, type(superIdx), "")
        val interfacesOff = u4(base + 12)
        if (interfacesOff != 0) {
            val n = u4(interfacesOff)
            for (k in 0 until n) refs += Ref(RefKind.SUPER, type(u2(interfacesOff + 4 + 2 * k)), "")
        }
        val classDataOff = u4(base + 24)
        if (classDataOff != 0) readClassData(classDataOff, refs)
        DexClass(name, refs)
    }

    private var pos = 0
    private fun uleb(): Int {
        var result = 0
        var shift = 0
        while (true) {
            val x = u1(pos++)
            result = result or ((x and 0x7F) shl shift)
            if (x and 0x80 == 0) return result
            shift += 7
        }
    }

    private fun readClassData(off: Int, refs: MutableSet<Ref>) {
        pos = off
        val staticFields = uleb()
        val instanceFields = uleb()
        val directMethods = uleb()
        val virtualMethods = uleb()
        repeat(staticFields + instanceFields) { uleb(); uleb() }
        val codeOffs = mutableListOf<Int>()
        repeat(directMethods + virtualMethods) {
            uleb() // method_idx_diff
            uleb() // access flags
            val codeOff = uleb()
            if (codeOff != 0) codeOffs += codeOff
        }
        codeOffs.forEach { readCode(it, refs) }
    }

    private fun readCode(off: Int, refs: MutableSet<Ref>) {
        val units = u4(off + 12)
        val start = off + 16
        fun unit(k: Int) = u2(start + 2 * k)
        var i = 0
        while (i < units) {
            val u = unit(i)
            val op = u and 0xFF
            if (op == 0x00 && u != 0) {
                // Payloads (data inside the code, not instructions).
                when (u) {
                    0x0100 -> { i += unit(i + 1) * 2 + 4; continue }
                    0x0200 -> { i += unit(i + 1) * 4 + 2; continue }
                    0x0300 -> {
                        val width = unit(i + 1)
                        val size = unit(i + 2) or (unit(i + 3) shl 16)
                        i += (size * width + 1) / 2 + 4
                        continue
                    }
                }
            }
            when (op) {
                0x1A -> refs += Ref(RefKind.STRING, string(unit(i + 1)), "")
                0x1B -> refs += Ref(RefKind.STRING, string(unit(i + 1) or (unit(i + 2) shl 16)), "")
                0x1C, 0x1F, 0x20, 0x22, 0x23, 0x24, 0x25 -> refs += Ref(RefKind.TYPE, type(unit(i + 1)), "")
                in 0x52..0x6D -> field(unit(i + 1)).let { refs += Ref(RefKind.FIELD, it.first, it.second) }
                in 0x6E..0x72, in 0x74..0x78, 0xFA, 0xFB ->
                    method(unit(i + 1)).let { refs += Ref(RefKind.METHOD, it.first, it.second) }
            }
            i += SIZE[op]
        }
    }

    companion object {
        /** Instruction length in 16-bit code units, by opcode (Dalvik bytecode formats). */
        private val SIZE = IntArray(256) { 1 }.apply {
            fun set(range: IntRange, n: Int) = range.forEach { this[it] = n }
            set(0x02..0x02, 2); set(0x03..0x03, 3); set(0x05..0x05, 2); set(0x06..0x06, 3)
            set(0x08..0x08, 2); set(0x09..0x09, 3)
            set(0x13..0x13, 2); set(0x14..0x14, 3); set(0x15..0x16, 2); set(0x17..0x17, 3)
            set(0x18..0x18, 5); set(0x19..0x1A, 2); set(0x1B..0x1B, 3); set(0x1C..0x1C, 2)
            set(0x1F..0x20, 2); set(0x22..0x23, 2); set(0x24..0x26, 3)
            set(0x29..0x29, 2); set(0x2A..0x2C, 3); set(0x2D..0x3D, 2)
            set(0x44..0x6D, 2); set(0x6E..0x72, 3); set(0x74..0x78, 3)
            set(0x90..0xAF, 2); set(0xD0..0xE2, 2)
            set(0xFA..0xFB, 4); set(0xFC..0xFD, 3); set(0xFE..0xFF, 2)
        }
    }
}

enum class RefKind { METHOD, FIELD, TYPE, STRING, SUPER }

/** [owner] is a class (or the string itself, for STRING); [member] a method or field name, else "". */
data class Ref(val kind: RefKind, val owner: String, val member: String)

data class DexClass(val name: String, val refs: Set<Ref>)
