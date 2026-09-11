package com.streamflixreborn.streamflix.fragments.player

import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.CustomTabHelper
import com.streamflixreborn.streamflix.utils.EpisodeManager
import com.streamflixreborn.streamflix.utils.OpenSubtitles
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.format
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import com.streamflixreborn.streamflix.vod.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import com.streamflixreborn.streamflix.utils.SubDL

class PlayerViewModel(
    videoType: Video.Type,
    id: String,
) : ViewModel() {

    private val _state = MutableStateFlow<State>(State.LoadingServers)
    val state: Flow<State> = _state

    private val _subtitleState = MutableSharedFlow<SubtitleState>()
    val subtitleState: SharedFlow<SubtitleState> = _subtitleState

    private val _playPreviousOrNextEpisode = MutableSharedFlow<Video.Type.Episode>()
    val playPreviousOrNextEpisode: SharedFlow<Video.Type.Episode> = _playPreviousOrNextEpisode
    private var lastVideoType: Video.Type? = null
    private var lastId: String? = null
    private var resolveJob: Job? = null
    private var serversJob: Job? = null
    private var debridJob: Job? = null
    private var debridAccountRevision = -1L
    private var subtitleJob: Job? = null
    private var generation = 0
    private val attempted = mutableSetOf<String>()
    private val _sources = MutableStateFlow<List<Video.Server>>(emptyList())
    val sources: kotlinx.coroutines.flow.StateFlow<List<Video.Server>> = _sources
    val sourceStatus = MutableStateFlow("")
    private val initialType = videoType
    val contentType: Video.Type get() = lastVideoType ?: initialType

    fun reportTracks(server: Video.Server, tracks: androidx.media3.common.Tracks) {
        val video = tracks.groups.firstOrNull { it.type == androidx.media3.common.C.TRACK_TYPE_VIDEO && it.isSelected }
            ?.let { group -> (0 until group.length).firstOrNull { group.isTrackSelected(it) }?.let { group.getTrackFormat(it) } }
            ?: return
        val audio = tracks.groups.firstOrNull { it.type == androidx.media3.common.C.TRACK_TYPE_AUDIO && it.isSelected }
            ?.let { group -> (0 until group.length).firstOrNull { group.isTrackSelected(it) }?.let { group.getTrackFormat(it) } }
            ?.sampleMimeType?.substringAfter('/')
        val details = (server.details ?: SourceDetails()).copy(
            height = video.height.takeIf { it > 0 },
            codec = when (video.sampleMimeType) { "video/hevc" -> "HEVC"; "video/av01" -> "AV1"; "video/avc" -> "H.264"; else -> video.sampleMimeType?.substringAfter('/') },
            hdr = when (video.colorInfo?.colorTransfer) { androidx.media3.common.C.COLOR_TRANSFER_ST2084 -> "HDR (PQ)"; androidx.media3.common.C.COLOR_TRANSFER_HLG -> "HLG"; else -> null },
            audio = audio, detected = true)
        _sources.update { rows -> rows.map { if (it.id == server.id) it.copy(details = details) else it } }
    }

    fun discoverDebrid() {
        val accountRevision = RealDebrid.sessionRevision
        if (accountRevision != debridAccountRevision || !RealDebrid.connected || !VodPreferences.debridSearch) {
            debridJob?.cancel()
            debridJob = null
            debridAccountRevision = accountRevision
            _sources.update { rows -> rows.filter { it.details?.kind != SourceDetails.Kind.REAL_DEBRID } }
            sourceStatus.value = ""
        }
        if (!RealDebrid.connected || !VodPreferences.debridSearch || debridJob != null) return
        val epoch = generation
        val type = contentType
        debridJob = viewModelScope.launch(Dispatchers.IO) {
            sourceStatus.value = "Searching Real-Debrid sources…"
            try {
                val added = SourceDiscovery.debrid(type)
                if (epoch == generation && accountRevision == RealDebrid.sessionRevision) {
                    _sources.update { rows -> (rows + added.sortedBy { DeviceCompatibility.rank(it.details) }).distinctBy { it.id } }
                    sourceStatus.value = if (added.isEmpty()) "No matching torrent sources" else ""
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (epoch == generation && accountRevision == RealDebrid.sessionRevision) { sourceStatus.value = e.message ?: "Search unavailable"; debridJob = null } }
        }
    }

    fun selectSource(server: Video.Server) { attempted.clear(); getVideo(server) }

    fun fallback(failed: Video.Server?): Boolean {
        failed?.let { attempted.add(it.id) }
        val next = _sources.value.firstOrNull {
            it.id !in attempted && it.details?.kind != SourceDetails.Kind.REAL_DEBRID
        } ?: return false
        if (attempted.size >= 5) return false
        getVideo(next)
        return true
    }

    init {
        getServers(videoType, id)
        getSubtitles(videoType)
    }

    fun playEpisode(direction: Direction) {
        val hasEpisode = when (direction) {
            Direction.PREVIOUS -> EpisodeManager.hasPreviousEpisode()
            Direction.NEXT -> EpisodeManager.hasNextEpisode()
        }

        if (!hasEpisode) return

        val ep = when (direction) {
            Direction.PREVIOUS -> EpisodeManager.getPreviousEpisode()
            Direction.NEXT -> EpisodeManager.getNextEpisode()
        } ?: return

        val nextEpisode = Video.Type.Episode(
            id = ep.id,
            number = ep.number,
            title = ep.title,
            poster = ep.poster,
            overview = ep.overview,
            tvShow = Video.Type.Episode.TvShow(
                id = ep.tvShow.id,
                title = ep.tvShow.title,
                poster = ep.tvShow.poster,
                banner = ep.tvShow.banner,
                releaseDate = ep.tvShow.releaseDate,
                imdbId = ep.tvShow.imdbId
            ),
            season = Video.Type.Episode.Season(
                number = ep.season.number,
                title = ep.season.title
            )
        )

        playEpisode(nextEpisode)

        viewModelScope.launch {
            _playPreviousOrNextEpisode.emit(nextEpisode)
        }
    }

    enum class Direction { PREVIOUS, NEXT }
    fun playPreviousEpisode() =
        playEpisode(Direction.PREVIOUS)

    fun playNextEpisode() =
        playEpisode(Direction.NEXT)

    fun autoplayNextEpisode() {
        if (UserPreferences.autoplay) {
            playEpisode(Direction.NEXT)
        }
    }
    fun playEpisode(episode: Video.Type.Episode) {
        getServers(episode, episode.id)
        getSubtitles(episode)
    }

    private fun getServers(videoType: Video.Type, id: String) {
        generation++
        resolveJob?.cancel()
        serversJob?.cancel()
        debridJob?.cancel()
        debridJob = null
        attempted.clear()
        _sources.value = emptyList()
        lastVideoType = videoType
        lastId = id
        serversJob = viewModelScope.launch(Dispatchers.IO) {
            _state.emit(State.LoadingServers)
            try {
                val provider = UserPreferences.currentProvider ?: throw Exception("Select a provider.")
                val servers = provider.getServers(id, videoType)
                coroutineContext.ensureActive()
                _sources.value = servers
                _state.emit(State.SuccessLoadingServers(servers))
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (RealDebrid.connected) _state.emit(State.SuccessLoadingServers(emptyList()))
                else _state.emit(State.FailedLoadingServers(e))
            }
        }
    }

    fun getVideo(server: Video.Server): Job {
        resolveJob?.cancel()
        attempted.add(server.id)
        return viewModelScope.launch(Dispatchers.IO) {
        Log.d("PlayerViewModel", "Inizio estrazione video dal server: ${server.name}")
        _state.emit(State.LoadingVideo(server))
        try {
            val video = if (server.details?.kind == SourceDetails.Kind.REAL_DEBRID)
                RealDebrid.resolve(server, contentType) else UserPreferences.currentProvider!!.getVideo(server)
            coroutineContext.ensureActive()
            if (video.source.isEmpty()) throw Exception("No source found")

            // LOGICA SOTTOTITOLI GLOBALE: 
            // Se il provider non ha già impostato un default (es. i "forced" in spagnolo),
            // allora proviamo ad attivare l'ultimo sottotitolo usato dall'utente.
            // MA: se siamo su un provider spagnolo e non ci sono forced, non dobbiamo attivare nulla.
            val currentProviderLang = UserPreferences.currentProvider?.language ?: ""
            val hasDefaultAlready = video.subtitles.any { it.default }

            if (!hasDefaultAlready && currentProviderLang != "es") {
                if (!(video.useServerSubtitleSetting && UserPreferences.serverAutoSubtitlesDisabled)) {
                    video.subtitles
                        .firstOrNull { it.label.startsWith(UserPreferences.subtitleName ?: "") }
                        ?.default = true
		}
            }

            Log.d("PlayerViewModel", "Estrazione video completata con successo")
            _state.emit(State.SuccessLoadingVideo(video, server))
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            // Never log resolved URLs or credentials.
            _state.emit(State.FailedLoadingVideo(e, server))
        }
        }.also { resolveJob = it }
    }

    fun getSubtitles(videoType: Video.Type): Job {
        subtitleJob?.cancel()
        return viewModelScope.launch(Dispatchers.IO) {
        Log.d("PlayerViewModel", "Inizio ricerca sottotitoli")
        _subtitleState.emit(SubtitleState.Loading)

        launch {
            try {
                Log.d("PlayerViewModel", "Inizio ricerca OpenSubtitles")
                val subtitles = when (videoType) {
                    is Video.Type.Episode -> {
                        OpenSubtitles.search(
                            query = videoType.tvShow.title,
                            season = videoType.season.number,
                            episode = videoType.number,
                        )
                    }
                    is Video.Type.Movie -> {
                        OpenSubtitles.search(query = videoType.title)
                    }
                }.sortedWith(compareBy({ it.languageName }, { it.subDownloadsCnt }))
                
                Log.d("PlayerViewModel", "Ricerca OpenSubtitles completata: ${subtitles.size} risultati")
                _subtitleState.emit(SubtitleState.SuccessOpenSubtitles(subtitles))
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                _subtitleState.emit(SubtitleState.FailedOpenSubtitles(e))
            }
        }

        launch {
            try {
                Log.d("PlayerViewModel", "Inizio ricerca SubDL")
                val subtitles = when (videoType) {
                    is Video.Type.Episode -> {
                        SubDL.search(
                            filmName = videoType.tvShow.title,
                            seasonNumber = videoType.season.number,
                            episodeNumber = videoType.number,
                            type = "tv"
                        )
                    }
                    is Video.Type.Movie -> {
                        SubDL.search(
                            filmName = videoType.title,
                            type = "movie"
                        )
                    }
                }
                
                Log.d("PlayerViewModel", "Ricerca SubDL completata: ${subtitles.size} risultati")
                _subtitleState.emit(SubtitleState.SuccessSubDLSubtitles(subtitles))
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                _subtitleState.emit(SubtitleState.FailedSubDLSubtitles(e))
            }
        }
        }.also { subtitleJob = it }
    }

    fun downloadSubtitle(subtitle: OpenSubtitles.Subtitle) = viewModelScope.launch(Dispatchers.IO) {
        Log.d("PlayerViewModel", "Inizio download sottotitolo OpenSubtitles: ${subtitle.subFileName}")
        _subtitleState.emit(SubtitleState.DownloadingOpenSubtitle)
        try {
            val uri = OpenSubtitles.download(subtitle)
            Log.d("PlayerViewModel", "Download OpenSubtitles completato: $uri")
            _subtitleState.emit(SubtitleState.SuccessDownloadingOpenSubtitle(subtitle, uri))
        } catch (e: Exception) {
            Log.e("PlayerViewModel", "Errore download OpenSubtitles: ", e)
            _subtitleState.emit(SubtitleState.FailedDownloadingOpenSubtitle(e, subtitle))
        }
    }

    fun downloadSubDLSubtitle(subtitle: SubDL.Subtitle) = viewModelScope.launch(Dispatchers.IO) {
        Log.d("PlayerViewModel", "Inizio download sottotitolo SubDL: ${subtitle.name}")
        _subtitleState.emit(SubtitleState.DownloadingSubDLSubtitle)
        try {
            val uri = SubDL.download(subtitle)
            Log.d("PlayerViewModel", "Download SubDL completato: $uri")
            _subtitleState.emit(SubtitleState.SuccessDownloadingSubDLSubtitle(subtitle, uri))
        } catch (e: Exception) {
            Log.e("PlayerViewModel", "Errore download SubDL: ", e)
            _subtitleState.emit(SubtitleState.FailedDownloadingSubDLSubtitle(e, subtitle))
        }
    }

    sealed class State {
        data object LoadingServers : State()
        data class SuccessLoadingServers(val servers: List<Video.Server>) : State()
        data class FailedLoadingServers(val error: Exception) : State()
        data class LoadingVideo(val server: Video.Server) : State()
        data class SuccessLoadingVideo(val video: Video, val server: Video.Server) : State()
        data class FailedLoadingVideo(val error: Exception, val server: Video.Server) : State()
    }

    sealed class SubtitleState {
        data object Loading : SubtitleState()
        data class SuccessOpenSubtitles(val subtitles: List<OpenSubtitles.Subtitle>) : SubtitleState()
        data class FailedOpenSubtitles(val error: Exception) : SubtitleState()
        data object DownloadingOpenSubtitle : SubtitleState()
        data class SuccessDownloadingOpenSubtitle(val subtitle: OpenSubtitles.Subtitle, val uri: Uri) : SubtitleState()
        data class FailedDownloadingOpenSubtitle(val error: Exception, val subtitle: OpenSubtitles.Subtitle) : SubtitleState()

        data class SuccessSubDLSubtitles(val subtitles: List<SubDL.Subtitle>) : SubtitleState()
        data class FailedSubDLSubtitles(val error: Exception) : SubtitleState()
        data object DownloadingSubDLSubtitle : SubtitleState()
        data class SuccessDownloadingSubDLSubtitle(val subtitle: SubDL.Subtitle, val uri: Uri) : SubtitleState()
        data class FailedDownloadingSubDLSubtitle(val error: Exception, val subtitle: SubDL.Subtitle) : SubtitleState()
    }
    fun reloadServersAfterBypass() {
        val type = lastVideoType ?: return
        val id = lastId ?: return
        getServers(type, id)
    }
}
