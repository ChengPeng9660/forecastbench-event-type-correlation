from analysis.market_diversity_performance import information_metadata, prompt_metadata


def test_prompt_and_information_conditions_remain_separate() -> None:
    assert prompt_metadata("zero shot with freeze values") == ("zero_shot", "Zero shot")
    assert prompt_metadata("scratchpad with news with freeze values") == (
        "scratchpad",
        "Scratchpad",
    )
    assert information_metadata("zero shot") == ("none", "No extra information")
    assert information_metadata("zero shot with freeze values") == (
        "freeze_values",
        "Freeze values",
    )
    assert information_metadata("scratchpad with news") == ("news", "News")
    assert information_metadata("scratchpad with news with freeze values") == (
        "news_freeze",
        "News + freeze",
    )
    assert information_metadata("zero shot with web search") == (
        "web_search",
        "Web search",
    )
