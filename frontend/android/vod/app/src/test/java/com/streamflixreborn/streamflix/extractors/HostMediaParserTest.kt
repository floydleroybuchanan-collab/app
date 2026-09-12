package com.streamflixreborn.streamflix.extractors

import org.junit.Assert.*
import org.junit.Test

/** Synthetic host markup: no copyrighted video, live account or expiring URL required. */
class HostMediaParserTest {
    @Test fun sendvidVideoTagAndCaptionTrack() {
        val video=HostMediaParser.parse("https://sendvid.com/clip", """
            <video><source src="https://cdn.example.test/clip.mp4" type="video/mp4">
            <track kind="captions" label="English" src="/captions.vtt"></video>""")!!
        assertEquals("https://cdn.example.test/clip.mp4",video.source)
        assertEquals("https://sendvid.com/captions.vtt",video.subtitles.single().file)
        assertEquals("https://sendvid.com/clip",video.headers!!["Referer"])
        assertEquals("https://sendvid.com",video.headers!!["Origin"])
        assertEquals("https://sendvid.com/clip",video.originalHostUrl)
    }
    @Test fun earnvidsHlsVariantsAndEscapedQueries() {
        val video=HostMediaParser.parse("https://earnvids.com/e/clip", """
            <script>var player={hls2:"https:\/\/cdn.example.test\/master.m3u8?token=a\u0026b=c"};</script>""")!!
        assertEquals("https://cdn.example.test/master.m3u8?token=a&b=c",video.source)
    }
    @Test fun sibnetRelativeAndMp4UploadAssignments() {
        assertEquals("https://video.sibnet.ru/v/clip.mp4",HostMediaParser.parse("https://video.sibnet.ru/shell.php?videoid=1",
            """<script>player.src({src:"/v/clip.mp4",type:"video/mp4"});</script>""")!!.source)
        assertEquals("https://cdn.example.test/clip.mp4",HostMediaParser.parse("https://mp4upload.com/embed-clip.html",
            """<script>player.src = "https://cdn.example.test/clip.mp4";</script>""")!!.source)
    }
    @Test fun uqloadArrayVidmolyAndVidozaPlayerFields() {
        for(host in listOf("uqload.to","vidmoly.to","vidoza.net")) {
            val markup=if(host=="uqload.to") """<script>player({sources:["//cdn.example.test/clip.mp4"]});</script>"""
                else """<script>player({sources:[{file:"//cdn.example.test/clip.mp4"}]});</script>"""
            assertEquals("https://cdn.example.test/clip.mp4",HostMediaParser.parse("https://"+host+"/embed-clip",markup)!!.source)
        }
    }
    @Test fun vkPrefersHlsOverMp4AndRetainsPortInOrigin() {
        val video=HostMediaParser.parse("https://vk.com:8443/video1", """
            <script>var p={url720:"https://cdn.example.test/720.mp4",hls:"https://cdn.example.test/master.m3u8"};</script>""")!!
        assertEquals("https://cdn.example.test/master.m3u8",video.source)
        assertEquals("https://vk.com:8443",video.headers!!["Origin"])
    }
    @Test fun doesNotTreatArbitraryPageLinksOrInvalidSchemesAsVideo() {
        for(markup in listOf("<a href='https://cdn.example.test/ad.mp4'>Advertisement</a>",
            "<script src='https://cdn.example.test/player.js'></script>",
            "<video src='javascript:alert(1)'></video>","<video src='https://user:pass@cdn.example.test/video.mp4'></video>"))
            assertNull(HostMediaParser.parse("https://sendvid.com/clip",markup))
    }
}
